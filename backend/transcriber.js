const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
// The 'exec' from child_process is no longer needed
// const { exec } = require('child_process'); 
const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const processingRooms = new Set();

async function processAudioForRoom(roomID, io) {
    if (processingRooms.has(roomID)) {
        console.log(`[${roomID}] Process already running. New file will be picked up in the current cycle.`);
        return;
    }

    processingRooms.add(roomID);
    console.log(`[${roomID}] Starting transcription process...`);

    const roomRecordingsDir = path.join(__dirname, 'recordings', roomID);
    const roomTranscriptsDir = path.join(__dirname, 'transcripts', roomID);
    const processedDir = path.join(roomRecordingsDir, 'processed');
    const transcriptFilePath = path.join(roomTranscriptsDir, 'transcript.txt');

    try {
        await fs.mkdir(roomRecordingsDir, { recursive: true });
        await fs.mkdir(roomTranscriptsDir, { recursive: true });
        await fs.mkdir(processedDir, { recursive: true });

        while (true) {
            const filesForThisRoom = await fs.readdir(roomRecordingsDir);
            const unprocessedFiles = filesForThisRoom.filter(file => {
                return file.endsWith('.webm') && !file.startsWith('processed-');
            });

            if (unprocessedFiles.length === 0) {
                console.log(`[${roomID}] No more files to process. Ending cycle.`);
                break;
            }

            const filesToProcess = unprocessedFiles
                .map(file => {
                    const regex = new RegExp(`^${roomID}-(.+?)-(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2})\\.webm$`);
                    const match = file.match(regex);
                    
                    if (!match) {
                        console.warn(`[${roomID}] Skipping malformed file: ${file}`);
                        return null;
                    }

                    const speaker = match[1];
                    const timestampStr = match[2];
                    const sortableDate = new Date(timestampStr.replace('_', 'T') + 'Z');

                    return {
                        filename: file,
                        speaker,
                        timestamp: timestampStr.replace('_', ' '),
                        sortableDate
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.sortableDate - b.sortableDate);

            if (filesToProcess.length === 0) {
                console.log(`[${roomID}] All remaining files were malformed. Ending cycle.`);
                break;
            }

            for (const fileInfo of filesToProcess) {
                // This is the path to the original .webm file
                const filePath = path.join(roomRecordingsDir, fileInfo.filename);
                
                try {
                    if (!fsSync.existsSync(filePath)) {
                        console.warn(`[${roomID}] File deleted before processing: ${fileInfo.filename}`);
                        continue;
                    }

                    // --- FFmpeg processing has been removed ---

                    console.log(`[${roomID}] Sending file directly to Groq for transcription: ${fileInfo.filename}`);
                    
                    // Directly transcribe the original .webm file
                    const transcription = await groq.audio.transcriptions.create({
                        file: fsSync.createReadStream(filePath),
                        model: "whisper-large-v3",
                    });

                    if (transcription.text && transcription.text.trim()) {
                        const transcriptText = `[${fileInfo.timestamp}] ${fileInfo.speaker}: ${transcription.text.trim()}\n`;
                        await fs.appendFile(transcriptFilePath, transcriptText);
                        console.log(`[${roomID}] Transcript added for ${fileInfo.speaker}.`);
                        
                        if (io) {
                            io.to(roomID).emit('new_transcript', {
                                line: transcriptText.trim()
                            });
                            console.log(`[${roomID}] Emitted new transcript to room.`);
                        }
                    }

                } catch (err) {
                    // This will now catch errors from the Groq API call
                    console.error(`[${roomID}] Error during transcription for ${fileInfo.filename}: ${err.message}`);
                } finally {
                    // Move the original file to the processed directory after attempting transcription
                    try {
                        if (fsSync.existsSync(filePath)) {
                            await fs.unlink(filePath);
                           console.log(`[${roomID}] Original file deleted to processed: ${fileInfo.filename}`);
                        }
                    } catch (deleteErr) {
                        console.error(`[${roomID}] Failed to move original file: ${fileInfo.filename}`, moveErr);
                    }
                }
            }
        }

    } catch (err) {
        console.error(`[${roomID}] Critical error in transcription process:`, err);
    } finally {
        console.log(`[${roomID}] Transcription cycle finished. Waiting for next trigger.`);
        processingRooms.delete(roomID);
    }
}

module.exports = { processAudioForRoom };