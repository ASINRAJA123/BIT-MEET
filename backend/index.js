require('dotenv').config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { processAudioForRoom } = require('./transcriber');

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: process.env.ORIGIN || "*",
  },
});

app.use(cors());

const recordingsDir = path.join(__dirname, 'recordings');
const transcriptsDir = path.join(__dirname, 'transcripts');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const roomID = file.originalname.split('-').slice(0, 5).join('-');
        
        if (!roomID || roomID.length < 36) { // Basic validation for UUID
            return cb(new Error('Could not determine a valid room ID from filename.'), '');
        }

        const roomPath = path.join(recordingsDir, roomID);
        if (!fs.existsSync(roomPath)) {
            fs.mkdirSync(roomPath, { recursive: true });
        }
        
        cb(null, roomPath);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

app.post('/api/upload-audio', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No audio file uploaded.' });
    }
    console.log('Audio file saved successfully:', req.file.path);

    const roomID = req.file.filename.split('-').slice(0, 5).join('-');
    
    processAudioForRoom(roomID, io);

    res.status(200).json({
        message: 'File uploaded and queued for transcription!',
        filename: req.file.filename
    });
});

app.get('/api/transcript/:roomID', async (req, res) => {
    const { roomID } = req.params;
    const transcriptFilePath = path.join(transcriptsDir, roomID, 'transcript.txt');

    try {
        await fs.promises.access(transcriptFilePath); 
        const content = await fs.promises.readFile(transcriptFilePath, 'utf8');
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.status(200).send(''); 
        } else {
            console.error(`[${roomID}] Error fetching transcript:`, error);
            res.status(500).json({ message: 'Error fetching transcript.' });
        }
    }
});

// ===== Socket.IO logic =====
const users = {};
const socketToRoom = {};
const PORT = process.env.PORT || 5000;

io.on("connection", (socket) => {
  socket.on("join room", ({ roomID, user }) => {
    if (users[roomID]) {
      users[roomID].push({ userId: socket.id, user });
    } else {
      users[roomID] = [{ userId: socket.id, user }];
    }
    socketToRoom[socket.id] = roomID;

    socket.join(roomID);
    console.log(`Socket ${socket.id} joined room ${roomID}`);
    
    const usersInThisRoom = users[roomID].filter(
      (user) => user.userId !== socket.id
    );
    socket.emit("all users", usersInThisRoom);
  });

  socket.on("sending signal", (payload) => {
    io.to(payload.userToSignal).emit("user joined", {
      signal: payload.signal,
      callerID: payload.callerID,
      user: payload.user,
    });
  });

  socket.on("returning signal", (payload) => {
    io.to(payload.callerID).emit("receiving returned signal", {
      signal: payload.signal,
      id: socket.id,
    });
  });

  socket.on("send message", (payload) => {
    io.to(payload.roomID).emit("message", payload);
  });

  // ✅ THIS BLOCK IS NOW FIXED AND MORE ROBUST
  socket.on("disconnect", () => {
    const roomID = socketToRoom[socket.id];

    // Check if the user was actually in a room to prevent errors
    if (roomID) {
      let room = users[roomID];
      if (room) {
        room = room.filter((item) => item.userId !== socket.id);
        users[roomID] = room;
      }
      
      // Use the correct syntax: .broadcast first, then .to(roomID)
      socket.broadcast.to(roomID).emit("user left", socket.id);
      console.log(`Socket ${socket.id} disconnected from room ${roomID}`);
    } else {
      console.log(`Socket ${socket.id} disconnected (was not in a room).`);
    }

    // Always clean up the socket from the lookup table
    delete socketToRoom[socket.id];
  });
});

console.clear();
server.listen(PORT, () =>
  console.log(`Server is running on port http://localhost:${PORT}`)
);