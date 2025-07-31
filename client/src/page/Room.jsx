import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
// Import icons and other UI components as before
import { FaRecordVinyl as RecordIcon } from "react-icons/fa";
import { IoChatboxOutline as ChatIcon } from "react-icons/io5";
import { VscTriangleDown as DownIcon } from "react-icons/vsc";
import { FaUsers as UsersIcon } from "react-icons/fa";
import { FiSend as SendIcon } from "react-icons/fi";
import { FcGoogle as GoogleIcon } from "react-icons/fc";
import { MdCallEnd as CallEndIcon } from "react-icons/md";
import { MdClear as ClearIcon } from "react-icons/md";
import { AiOutlineLink as LinkIcon } from "react-icons/ai";
import { MdOutlineContentCopy as CopyToClipboardIcon } from "react-icons/md";
import { IoVideocamSharp as VideoOnIcon } from "react-icons/io5";
import { IoVideocamOff as VideoOffIcon } from "react-icons/io5";
import { AiOutlineShareAlt as ShareIcon } from "react-icons/ai";
import { IoMic as MicOnIcon } from "react-icons/io5";
import { IoMicOff as MicOffIcon } from "react-icons/io5";
import { BsPin as PinIcon } from "react-icons/bs";
import { BsPinFill as PinActiveIcon } from "react-icons/bs";
import { QRCode } from "react-qrcode-logo";
import MeetGridCard from "../components/MeetGridCard";
import { motion, AnimatePresence } from "framer-motion";
import joinSFX from "../sounds/join.mp3";
import msgSFX from "../sounds/message.mp3";
import leaveSFX from "../sounds/leave.mp3";
import Peer from "simple-peer";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext";
import Loading from "../components/Loading";
// Import the VAD library
import { AudioNodeVAD } from "@ricky0123/vad-web";

const Room = () => {
    // --- STATE AND REFS ---
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const [micOn, setMicOn] = useState(true);
    const [showChat, setshowChat] = useState(true);
    const [share, setShare] = useState(false);
    const [joinSound] = useState(new Audio(joinSFX));
    const { roomID } = useParams();
    const chatScroll = useRef();
    const [pin, setPin] = useState(false);
    const [peers, setPeers] = useState([]);
    const socket = useRef();
    const peersRef = useRef([]);
    const localStream = useRef();
    const [videoActive, setVideoActive] = useState(true);
    const [msgs, setMsgs] = useState([]);
    const [msgText, setMsgText] = useState("");
    const localVideo = useRef();
    const { user, login } = useAuth();
    const [particpentsOpen, setParticpentsOpen] = useState(true);

    // Real-time Transcripts State and Ref
    const [transcriptLines, setTranscriptLines] = useState([]);
    const transcriptScroll = useRef();

    // Manual Recording Refs
    const [isRecording, setIsRecording] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);

    // Audio Processing and VAD Refs
    const audioContextRef = useRef(null);
    const vadRef = useRef(null);
    const vadRecorderRef = useRef(null);
    const vadAudioChunksRef = useRef([]);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [vadThreshold, setVadThreshold] = useState(0.50);

    // --- CALLBACK FUNCTIONS ---
    const sendMessage = (e) => {
        e.preventDefault();
        if (msgText) {
            socket.current.emit("send message", {
                roomID,
                from: socket.current.id,
                user: { id: user.uid, name: user?.displayName, profilePic: user.photoURL },
                message: msgText.trim(),
            });
        }
        setMsgText("");
    };

    const sendAudioToServer = useCallback(async (audioBlob, isChunk = false) => {
        if (!audioBlob || audioBlob.size < 200) return; // Add size check
        const formData = new FormData();
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_` +
            `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        const fileName = `${roomID}-${user?.displayName || 'anonymous'}-${timestamp}.webm`;
        formData.append('audio', audioBlob, fileName);
        try {
            await axios.post('http://localhost:5000/api/upload-audio', formData);
            if (isChunk) {
                console.log(`VAD chunk sent successfully: ${fileName}`);
            } else {
                alert('Manual recording saved successfully!');
            }
        } catch (error) {
            console.error('Error uploading audio:', error);
            if (!isChunk) alert('Failed to save the manual recording.');
        } finally {
            if (!isChunk) setIsSaving(false);
        }
    }, [roomID, user]);

    const createPeer = useCallback((userToSignal, callerID, stream) => {
        const peer = new Peer({ initiator: true, trickle: false, stream });
        peer.on("signal", (signal) => {
            socket.current.emit("sending signal", {
                userToSignal,
                callerID,
                signal,
                user: user ? { uid: user?.uid, email: user?.email, name: user?.displayName, photoURL: user?.photoURL } : null,
            });
        });
        return peer;
    }, [user]);

    const addPeer = useCallback((incomingSignal, callerID, stream) => {
        const peer = new Peer({ initiator: false, trickle: false, stream });
        peer.on("signal", (signal) => {
            socket.current.emit("returning signal", { signal, callerID });
        });
        joinSound.play();
        peer.signal(incomingSignal);
        return peer;
    }, [joinSound]);
    
    // Auto-scroll the transcript panel
    useEffect(() => {
        if (transcriptScroll.current) {
            transcriptScroll.current.scrollTop = transcriptScroll.current.scrollHeight;
        }
    }, [transcriptLines]);


    // --- MAIN useEffect for STREAM, AUDIO PROCESSING, VAD, and WEBRTC ---
    useEffect(() => {
        if (!user) return;

        socket.current = io.connect("http://localhost:5000");
        
        // Listen for new transcript lines from the server
        socket.current.on('new_transcript', (data) => {
            console.log('New transcript received:', data.line);
            setTranscriptLines(prevLines => [...prevLines, data.line]);
        });
        
        socket.current.on("message", (data) => {
            const audio = new Audio(msgSFX);
            if (user?.uid !== data.user.id) audio.play();
            setMsgs((prevMsgs) => [...prevMsgs, { send: user?.uid === data.user.id, ...data }]);
        });

        const setupMedia = async () => {
            try {
                // Fetch initial transcript history when joining the room
                const fetchInitialTranscript = async () => {
                    try {
                        const response = await axios.get(`http://localhost:5000/api/transcript/${roomID}`);
                        if (response.data) {
                            const lines = response.data.split('\n').filter(line => line.trim() !== '');
                            setTranscriptLines(lines);
                        }
                    } catch (error) {
                        console.error("Failed to fetch initial transcript:", error);
                    }
                };
                await fetchInitialTranscript();

                // 1. Get raw media stream from device
                const rawStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                });

                // 2. Setup AudioContext and the core processing pipeline
                if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 16000 });
                const audioContext = audioContextRef.current;
                const source = audioContext.createMediaStreamSource(rawStream);
                
                const highpassFilter = audioContext.createBiquadFilter();
                highpassFilter.type = 'highpass'; highpassFilter.frequency.value = 80;
                const compressor = audioContext.createDynamicsCompressor();
                compressor.threshold.value = -40; compressor.knee.value = 30; compressor.ratio.value = 12;
                
                const finalStreamDestination = audioContext.createMediaStreamDestination();

                // 3. Setup VAD with the correct options
                const myVAD = await AudioNodeVAD.new(audioContext, {
                    positiveSpeechThreshold: vadThreshold,
                    minSpeechFrames: 4,
                    onSpeechStart: () => {
                        console.log("VAD: Speech started.");
                        setIsSpeaking(true);
                        if (vadRecorderRef.current || !micOn) return;

                        const trackToRecord = finalStreamDestination.stream.getAudioTracks()[0].clone();
                        const recorderStream = new MediaStream([trackToRecord]);
                        vadRecorderRef.current = new MediaRecorder(recorderStream, { mimeType: 'audio/webm' });
                        vadAudioChunksRef.current = [];

                        vadRecorderRef.current.ondataavailable = (e) => {
                            if (e.data.size > 0) vadAudioChunksRef.current.push(e.data);
                        };
                        vadRecorderRef.current.onstop = () => {
                            const audioBlob = new Blob(vadAudioChunksRef.current, { type: 'audio/webm' });
                            sendAudioToServer(audioBlob, true);
                            vadAudioChunksRef.current = [];
                            recorderStream.getTracks().forEach(track => track.stop());
                        };
                        vadRecorderRef.current.start();
                    },
                    onSpeechEnd: () => {
                        console.log("VAD: Speech ended.");
                        setIsSpeaking(false);
                        if (vadRecorderRef.current?.state === 'recording') {
                            vadRecorderRef.current.stop();
                        }
                        vadRecorderRef.current = null;
                    },
                });
                vadRef.current = myVAD;

                // 4. CONNECT THE AUDIO GRAPH
                const processor = source.connect(highpassFilter).connect(compressor);
                processor.connect(myVAD.audioNode);
                processor.connect(finalStreamDestination);

                // 5. Create the final stream for peers and local display
                const finalStream = new MediaStream([
                    rawStream.getVideoTracks()[0], 
                    finalStreamDestination.stream.getAudioTracks()[0]
                ]);

                localStream.current = finalStream;
                if (localVideo.current) localVideo.current.srcObject = finalStream;
                setLoading(false);
                
                if (micOn) myVAD.start();

                // 6. Setup WebRTC and Socket.IO with the final, clean stream
                socket.current.emit("join room", {
                    roomID,
                    user: user ? { uid: user?.uid, email: user?.email, name: user?.displayName, photoURL: user?.photoURL } : null,
                });
                
                socket.current.on("all users", (users) => {
                    const newPeers = users.map(peerData => {
                        const peer = createPeer(peerData.userId, socket.current.id, finalStream);
                        peersRef.current.push({ peerID: peerData.userId, peer, user: peerData.user });
                        return { peerID: peerData.userId, peer, user: peerData.user };
                    });
                    setPeers(newPeers);
                });

                socket.current.on("user joined", (payload) => {
                    const peer = addPeer(payload.signal, payload.callerID, finalStream);
                    peersRef.current.push({ peerID: payload.callerID, peer, user: payload.user });
                    setPeers((prevPeers) => [...prevPeers, { peerID: payload.callerID, peer, user: payload.user }]);
                });

                socket.current.on("receiving returned signal", (payload) => {
                    const item = peersRef.current.find((p) => p.peerID === payload.id);
                    if (item) item.peer.signal(payload.signal);
                });

                socket.current.on("user left", (id) => {
                    new Audio(leaveSFX).play();
                    const peerObj = peersRef.current.find((p) => p.peerID === id);
                    if (peerObj) peerObj.peer.destroy();
                    const newPeers = peersRef.current.filter((p) => p.peerID !== id);
                    peersRef.current = newPeers;
                    setPeers(newPeers);
                });

            } catch (err) {
                console.error("Error setting up media:", err);
                alert("Could not access camera or microphone. Please check permissions and refresh.");
                setLoading(false);
            }
        };

        setupMedia();

        // 7. Cleanup function
        return () => {
            if (vadRef.current) { vadRef.current.destroy(); vadRef.current = null; }
            if (localStream.current) { localStream.current.getTracks().forEach(track => track.stop()); }
            if (audioContextRef.current?.state !== 'closed') { audioContextRef.current.close(); audioContextRef.current = null; }
            if (socket.current) { socket.current.disconnect(); }
            peersRef.current.forEach(p => p.peer.destroy());
            peersRef.current = [];
        };
    }, [user, roomID, joinSound, addPeer, createPeer, vadThreshold, sendAudioToServer, micOn]);


    // --- MANUAL RECORDING HANDLERS ---
    const handleStartRecording = () => {
        const audioTrack = localStream.current?.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState !== 'live') {
            alert("Could not start recording: audio track not available.");
            return;
        }

        const clonedTrack = audioTrack.clone();
        const stream = new MediaStream([clonedTrack]);
        mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];

        mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorderRef.current.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            sendAudioToServer(audioBlob, false);
            audioChunksRef.current = [];
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);
    };

    const handleStopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsSaving(true);
        }
    };

    // --- RENDER ---
    return (
        <>
            {user ? (
                <AnimatePresence>
                    {loading ? (
                        <div className="bg-lightGray">
                            <Loading />
                        </div>
                    ) : (
                        user && (
                            <motion.div
                                layout
                                className="flex flex-row bg-darkBlue2 text-white w-full"
                            >
                                <motion.div
                                    layout
                                    className="flex flex-col bg-darkBlue2 justify-between w-full"
                                >
                                    <div
                                        className="flex-shrink-0 overflow-y-scroll p-3"
                                        style={{
                                            height: "calc(100vh - 64px)",
                                        }}
                                    >
                                        <motion.div
                                            layout
                                            className={`grid grid-cols-1 gap-4  ${showChat
                                                    ? "md:grid-cols-2"
                                                    : "lg:grid-cols-3 sm:grid-cols-2"
                                                } `}
                                        >
                                            <motion.div
                                                layout
                                                className={`relative bg-lightGray rounded-lg aspect-video overflow-hidden ${pin &&
                                                    "md:col-span-2 md:row-span-2 md:col-start-1 md:row-start-1"
                                                    }`}
                                            >
                                                <div className="absolute top-4 right-4 z-20">
                                                    <button
                                                        className={`${pin
                                                                ? "bg-blue border-transparent"
                                                                : "bg-slate-800/70 backdrop-blur border-gray"
                                                            } md:border-2 border-[1px] aspect-square md:p-2.5 p-1.5 cursor-pointer md:rounded-xl rounded-lg text-white md:text-xl text-lg`}
                                                        onClick={() => setPin(!pin)}
                                                    >
                                                        {pin ? <PinActiveIcon /> : <PinIcon />}
                                                    </button>
                                                </div>

                                                <video
                                                    ref={localVideo}
                                                    muted
                                                    autoPlay
                                                    controls={false}
                                                    className="h-full w-full object-cover rounded-lg"
                                                />
                                                {!videoActive && (
                                                    <div className="absolute top-0 left-0 bg-lightGray h-full w-full flex items-center justify-center">
                                                        <img
                                                            className="h-[35%] max-h-[150px] w-auto rounded-full aspect-square object-cover"
                                                            src={user?.photoURL}
                                                            alt={user?.displayName}
                                                        />
                                                    </div>
                                                )}
                                                <div className="absolute bottom-4 left-4 flex flex-col gap-y-1">
                                                    <div className="bg-slate-800/70 backdrop-blur border-gray border-2  py-1 px-3 cursor-pointer rounded-md text-white text-xs">
                                                        {user?.displayName}
                                                    </div>
                                                    <div className={`text-xs font-bold py-0.5 px-2 rounded-full w-fit ${isSpeaking ? 'bg-green-500 text-white' : 'bg-black/50 text-gray-300'}`}>
                                                        VAD: {isSpeaking ? 'SPEAKING' : 'IDLE'}
                                                    </div>
                                                </div>
                                            </motion.div>
                                            {peers.map((peer) => (
                                                <MeetGridCard
                                                    key={peer?.peerID}
                                                    user={peer.user}
                                                    peer={peer?.peer}
                                                />
                                            ))}
                                        </motion.div>
                                    </div>

                                    <div className="w-full h-16 bg-darkBlue1 border-t-2 border-lightGray p-3">
                                        <div className="flex items-center justify-between">
                                            <div className="hidden lg:flex items-center gap-2 text-xs w-1/4 text-gray-400">
                                                <span>VAD Sensitivity</span>
                                                <input
                                                    type="range" min="0.3" max="0.9" step="0.05"
                                                    value={vadThreshold}
                                                    onChange={(e) => setVadThreshold(parseFloat(e.target.value))}
                                                    className="w-full"
                                                    title="Adjust speech detection sensitivity"
                                                />
                                                <span>{vadThreshold.toFixed(2)}</span>
                                            </div>
                                            <div className="flex-grow flex justify-center gap-3">
                                                <button
                                                    className={`${micOn ? "bg-blue border-transparent" : "bg-slate-800/70 backdrop-blur border-gray"} border-2 p-2 cursor-pointer rounded-xl text-white text-xl relative transition-all duration-300`}
                                                    onClick={() => {
                                                        if (localStream.current) {
                                                            const newMicState = !micOn;
                                                            localStream.current.getAudioTracks()[0].enabled = newMicState;
                                                            setMicOn(newMicState);
                                                            if (vadRef.current) {
                                                                newMicState ? vadRef.current.start() : vadRef.current.pause();
                                                            }
                                                        }
                                                    }}
                                                >
                                                    {micOn ? <MicOnIcon /> : <MicOffIcon />}
                                                </button>
                                                <button
                                                    className={`${videoActive ? "bg-blue border-transparent" : "bg-slate-800/70 backdrop-blur border-gray"} border-2 p-2 cursor-pointer rounded-xl text-white text-xl`}
                                                    onClick={() => {
                                                        if (localStream.current) {
                                                            localStream.current.getVideoTracks()[0].enabled = !videoActive;
                                                            setVideoActive(!videoActive);
                                                        }
                                                    }}
                                                >
                                                    {videoActive ? <VideoOnIcon /> : <VideoOffIcon />}
                                                </button>
                                                <button
                                                    disabled={isSaving}
                                                    onClick={isRecording ? handleStopRecording : handleStartRecording}
                                                    className={`border-2 p-2 cursor-pointer rounded-xl text-white text-xl ${isRecording ? "bg-red-500 animate-pulse border-transparent" : "bg-slate-800/70 backdrop-blur border-gray"} disabled:opacity-50`}
                                                >
                                                    {isSaving ? "..." : <RecordIcon />}
                                                </button>
                                                <button
                                                    className="py-2 px-4 flex items-center gap-2 rounded-lg bg-red-600"
                                                    onClick={() => {
                                                        navigate("/");
                                                        window.location.reload();
                                                    }}
                                                >
                                                    <CallEndIcon size={20} />
                                                    <span className="hidden sm:block text-xs">End Call</span>
                                                </button>
                                            </div>
                                            <div className="flex gap-2 w-1/4 justify-end">
                                                <button
                                                    className={`bg-slate-800/70 backdrop-blur border-gray border-2 p-2 cursor-pointer rounded-xl text-white text-xl`}
                                                    onClick={() => setShare(true)}
                                                >
                                                    <ShareIcon size={22} />
                                                </button>
                                                <button
                                                    className={`${showChat ? "bg-blue border-transparent" : "bg-slate-800/70 backdrop-blur border-gray"} border-2 p-2 cursor-pointer rounded-xl text-white text-xl`}
                                                    onClick={() => {
                                                        setshowChat(!showChat);
                                                    }}
                                                >
                                                    <ChatIcon />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                                {showChat && (
                                    <motion.div
                                        layout
                                        className="flex flex-col w-[30%] flex-shrink-0 border-l-2 border-lightGray"
                                    >
                                        <div
                                            className="flex-shrink-0 overflow-y-scroll"
                                            style={{
                                                height: "calc(100vh - 64px)",
                                            }}
                                        >
                                            <div className="flex flex-col bg-darkBlue1 w-full border-b-2 border-gray">
                                                <div
                                                    className="flex items-center w-full p-3 cursor-pointer"
                                                    onClick={() => setParticpentsOpen(!particpentsOpen)}
                                                >
                                                    <div className="text-xl text-slate-400">
                                                        <UsersIcon />
                                                    </div>
                                                    <div className="ml-2 text-sm font">Participants</div>
                                                    <div
                                                        className={`${particpentsOpen && "rotate-180"
                                                            } transition-all  ml-auto text-lg`}
                                                    >
                                                        <DownIcon />
                                                    </div>
                                                </div>
                                                <motion.div
                                                    layout
                                                    className={`${particpentsOpen ? "block" : "hidden"
                                                        } flex flex-col w-full mt-2 h-full max-h-[25vh] overflow-y-scroll gap-3 p-2`}
                                                >
                                                    <AnimatePresence>
                                                        <motion.div
                                                            layout
                                                            initial={{ x: 100, opacity: 0 }}
                                                            animate={{ x: 0, opacity: 1 }}
                                                            transition={{ duration: 0.08 }}
                                                            exit={{ opacity: 0 }}
                                                            whileHover={{ scale: 1.05 }}
                                                            className="p-2 flex bg-gray items-center transition-all hover:bg-slate-900 gap-2 rounded-lg"
                                                        >
                                                            <img
                                                                src={
                                                                    user.photoURL ||
                                                                    "https://parkridgevet.com.au/wp-content/uploads/2020/11/Profile-300x300.png"
                                                                }
                                                                alt={user.displayName || "Anonymous"}
                                                                className="block w-8 h-8 aspect-square rounded-full mr-2"
                                                            />
                                                            <span className="font-medium text-sm">
                                                                {user.displayName || "Anonymous"}
                                                            </span>
                                                        </motion.div>
                                                        {peers.map((peerData) => (
                                                            <motion.div
                                                                layout
                                                                initial={{ x: 100, opacity: 0 }}
                                                                animate={{ x: 0, opacity: 1 }}
                                                                transition={{ duration: 0.08 }}
                                                                exit={{ opacity: 0 }}
                                                                key={peerData.peerID}
                                                                whileHover={{ scale: 1.05 }}
                                                                className="p-2 flex bg-gray items-center transition-all hover:bg-slate-900 gap-2 rounded-lg"
                                                            >
                                                                <img
                                                                    src={
                                                                        peerData.user.photoURL ||
                                                                        "https://parkridgevet.com.au/wp-content/uploads/2020/11/Profile-300x300.png"
                                                                    }
                                                                    alt={peerData.user.name || "Anonymous"}
                                                                    className="block w-8 h-8 aspect-square rounded-full mr-2"
                                                                />
                                                                <span className="font-medium text-sm">
                                                                    {peerData.user.name || "Anonymous"}
                                                                </span>
                                                            </motion.div>
                                                        ))}
                                                    </AnimatePresence>
                                                </motion.div>
                                            </div>

                                            <div className="flex flex-col bg-darkBlue1 w-full border-b-2 border-t-2 border-lightGray">
                                                <div className="flex items-center p-3 w-full">
                                                    <div className="text-xl text-slate-400">
                                                        <RecordIcon />
                                                    </div>
                                                    <div className="ml-2 text-sm font">Live Transcript</div>
                                                </div>
                                                <motion.div
                                                    layout
                                                    ref={transcriptScroll}
                                                    className="p-3 flex flex-col gap-2 bg-darkBlue2 max-h-[30vh] overflow-y-auto"
                                                >
                                                    {transcriptLines.length > 0 ? (
                                                        transcriptLines.map((line, index) => (
                                                            <motion.p
                                                                layout
                                                                initial={{ opacity: 0, y: 10 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                key={index}
                                                                className="text-sm text-gray-200 leading-relaxed"
                                                            >
                                                                {line}
                                                            </motion.p>
                                                        ))
                                                    ) : (
                                                        <div className="text-center text-xs text-gray-500 italic p-4">
                                                            Waiting for transcription...
                                                        </div>
                                                    )}
                                                </motion.div>
                                            </div>

                                            <div className="h-full">
                                                <div className="flex items-center bg-darkBlue1 p-3 w-full">
                                                    <div className="text-xl text-slate-400">
                                                        <ChatIcon />
                                                    </div>
                                                    <div className="ml-2 text-sm font">Chat</div>
                                                </div>
                                                <motion.div
                                                    layout
                                                    ref={chatScroll}
                                                    className="p-3 h-full overflow-y-scroll flex flex-col gap-4"
                                                >
                                                    {msgs.map((msg, index) => (
                                                        <motion.div
                                                            layout
                                                            initial={{ x: msg.send ? 100 : -100, opacity: 0 }}
                                                            animate={{ x: 0, opacity: 1 }}
                                                            transition={{ duration: 0.08 }}
                                                            className={`flex gap-2 ${msg?.user.id === user?.uid
                                                                    ? "flex-row-reverse"
                                                                    : ""
                                                                }`}
                                                            key={index}
                                                        >
                                                            <img
                                                                src={msg?.user.profilePic}
                                                                alt={msg?.user.name}
                                                                className="h-8 w-8 aspect-square rounded-full object-cover"
                                                            />
                                                            <p className="bg-darkBlue1 py-2 px-3 text-xs w-auto max-w-[87%] rounded-lg border-2 border-lightGray">
                                                                {msg?.message}
                                                            </p>
                                                        </motion.div>
                                                    ))}
                                                </motion.div>
                                            </div>
                                        </div>
                                        <div className="w-full h-16 bg-darkBlue1 border-t-2 border-lightGray p-3">
                                            <form onSubmit={sendMessage}>
                                                <div className="flex items-center gap-2">
                                                    <div className="relative flex-grow">
                                                        <input
                                                            type="text"
                                                            value={msgText}
                                                            onChange={(e) => setMsgText(e.target.value)}
                                                            className="h-10 p-3 w-full text-sm text-darkBlue1 outline-none  rounded-lg"
                                                            placeholder="Enter message.. "
                                                        />
                                                        {msgText && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setMsgText("")}
                                                                className="bg-transparent text-darkBlue2 absolute top-0 right-0 text-lg cursor-pointer p-2  h-full"
                                                            >
                                                                <ClearIcon />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <button className="bg-blue h-10 text-md aspect-square rounded-lg flex items-center justify-center">
                                                            <SendIcon />
                                                        </button>
                                                    </div>
                                                </div>
                                            </form>
                                        </div>
                                    </motion.div>
                                )}
                            </motion.div>
                        )
                    )}
                    {share && (
                        <div className="fixed flex items-center justify-center top-0 left-0 h-full w-full z-30 bg-slate-800/60 backdrop-blur">
                            <div className="bg-white  p-3 rounded shadow shadow-white w-full mx-auto max-w-[500px] relative">
                                <div className="flex items-center justify-between">
                                    <div className="text-slate-800">
                                        Share the link with someone to join the room
                                    </div>
                                    <div>
                                        <ClearIcon
                                            size={30}
                                            color="#121212"
                                            onClick={() => setShare(false)}
                                        />
                                    </div>
                                </div>
                                <div className="my-5 rounded flex items-center justify-between gap-2 text-sm text-slate-500 bg-slate-200 p-2 ">
                                    <LinkIcon />
                                    <div className="flex-grow">
                                        {window.location.href.length > 40
                                            ? `${window.location.href.slice(0, 37)}...`
                                            : window.location.href}
                                    </div>
                                    <CopyToClipboardIcon
                                        className="cursor-pointer"
                                        onClick={() =>
                                            navigator.clipboard.writeText(window.location.href)
                                        }
                                    />
                                </div>
                                <div className="flex w-full aspect-square h-full justify-center items-center">
                                    <QRCode
                                        size={200}
                                        value={window.location.href}
                                        logoImage="/images/logo.png"
                                        qrStyle="dots"
                                        style={{ width: "100%" }}
                                        eyeRadius={10}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </AnimatePresence>
            ) : (
                <div className="h-full bg-darkBlue2 flex items-center justify-center">
                    <button
                        className="flex items-center gap-2 p-1 pr-3 rounded text-white font-bold bg-blue transition-all"
                        onClick={login}
                    >
                        <div className="p-2 bg-white rounded">
                            <GoogleIcon size={24} />
                        </div>
                        Login with Google
                    </button>
                </div>
            )}
        </>
    );
};

export default Room;