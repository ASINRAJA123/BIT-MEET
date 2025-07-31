// D:\sonic-meet\client\src\components\MeetGridCard.jsx

import { motion } from "framer-motion";
import React, { useEffect, useState, useRef } from "react";
import { BsPin as PinIcon, BsPinFill as PinActiveIcon } from "react-icons/bs";

const MeetGridCard = ({ user, peer }) => {
  const [pin, setPin] = useState(false);
  const videoRef = useRef();
  const [videoActive, setVideoActive] = useState(true);

  // --- MODIFIED: This useEffect now correctly listens for camera on/off events ---
  useEffect(() => {
    let videoTrack;
    peer.on("stream", (stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Find the video track to add listeners to it
      videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        // Set initial state
        setVideoActive(videoTrack.enabled);
        
        // Listen for when the track is enabled (camera turned on)
        videoTrack.onunmute = () => setVideoActive(true);
        
        // Listen for when the track is disabled (camera turned off)
        videoTrack.onmute = () => setVideoActive(false);
      }
    });

    // Cleanup function to prevent memory leaks
    return () => {
      if (videoTrack) {
        videoTrack.onunmute = null;
        videoTrack.onmute = null;
      }
    };
  }, [peer]); // Dependency array is important

  return (
    <motion.div
      layout
      className={`relative bg-lightGray rounded-lg shrink-0 aspect-video overflow-hidden ${
        pin && "md:col-span-2 md:row-span-2 md:col-start-1 md:row-start-1"
      }`}
    >
      <div className="absolute top-4 right-4 z-30">
        <button
          className={`${
            pin
              ? "bg-blue border-transparent"
              : "bg-slate-800/70 backdrop-blur border-gray"
          } md:border-2 border-[1px] aspect-square md:p-2.5 p-1.5 cursor-pointer md:rounded-xl rounded-lg text-white md:text-xl text-lg`}
          onClick={() => {
            setPin(!pin);
            window.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }}
        >
          {pin ? <PinActiveIcon /> : <PinIcon />}
        </button>
      </div>
      <video
        ref={videoRef}
        autoPlay
        controls={false}
        className="h-full w-full object-cover rounded-lg"
      />
      {!videoActive && (
        <div className="absolute top-0 left-0 bg-lightGray h-full w-full flex items-center justify-center">
          <img
            className="h-[35%] max-h-[150px] w-auto rounded-full aspect-square object-cover"
            src={
              user?.photoURL ||
              "https://parkridgevet.com.au/wp-content/uploads/2020/11/Profile-300x300.png"
            }
            alt={user?.name}
          />
        </div>
      )}
      <div className="absolute bottom-4 left-4">
        <div className="bg-slate-800/70 backdrop-blur border-gray border-2 py-1 px-3 cursor-pointer rounded-md text-white text-xs">
          {user?.name || "Anonymous"}
        </div>
      </div>
    </motion.div>
  );
};

export default MeetGridCard;