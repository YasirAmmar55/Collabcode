import React, { useState, useEffect, useRef } from 'react';
import { 
  FaMicrophone, FaMicrophoneSlash, FaVideo, FaVideoSlash, 
  FaPhoneSlash, FaWindowMinimize, FaTimes, FaDesktop 
} from 'react-icons/fa';
import './VideoPanel.css';

const VideoPanel = ({ participants, role, showToast, socket, roomId, currentUser, isTeacher, roomPermissions }) => {
  
  const [isMinimized, setIsMinimized] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
 
  
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [speakingUsers, setSpeakingUsers] = useState([]);
  
  const localVideoRef = useRef(null);
  const peerConnections = useRef({});
  
  const userId = currentUser?.id || 'local';
  const isHost = isTeacher || role === 'teacher' || role === 'host';

  // ========== PERMISSION CHECKS ==========
  const canUseMic = isHost || roomPermissions?.useMicrophone === true;
  const canUseCamera = isHost || roomPermissions?.useCamera === true;
 

  // Show warnings if permissions are disabled
  useEffect(() => {
    if (!isHost) {
      if (!canUseMic) {
        showToast('🔴 Teacher has disabled microphone for students', 'warning');
      }
      if (!canUseCamera) {
        showToast('🔴 Teacher has disabled camera for students', 'warning');
      }
      
      
    }
  }, []);

  // ========== WEBRTC SIGNALING ==========
  useEffect(() => {
    if (!socket || !roomId) return;

    socket.on('video-offer', async (data) => {
      if (data.targetId === userId) {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        peerConnections.current[data.fromId] = pc;
        
        if (localStream) {
          localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
          });
        }
        
        pc.ontrack = (event) => {
          setRemoteStreams(prev => ({
            ...prev,
            [data.fromId]: event.streams[0]
          }));
        };
        
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('video-ice-candidate', {
              roomId,
              candidate: event.candidate,
              targetId: data.fromId,
              fromId: userId
            });
          }
        };
        
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('video-answer', {
          roomId,
          answer,
          targetId: data.fromId,
          fromId: userId
        });
      }
    });
    
    socket.on('video-answer', async (data) => {
      if (data.targetId === userId) {
        const pc = peerConnections.current[data.fromId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      }
    });
    
    socket.on('video-ice-candidate', async (data) => {
      if (data.targetId === userId) {
        const pc = peerConnections.current[data.fromId];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      }
    });
    
    socket.on('user-left-video', (data) => {
      setRemoteStreams(prev => {
        const newStreams = { ...prev };
        delete newStreams[data.userId];
        return newStreams;
      });
      
      if (peerConnections.current[data.userId]) {
        peerConnections.current[data.userId].close();
        delete peerConnections.current[data.userId];
      }
    });
    
    return () => {
      socket.off('video-offer');
      socket.off('video-answer');
      socket.off('video-ice-candidate');
      socket.off('user-left-video');
    };
  }, [socket, roomId, userId, localStream]);

  // ========== INITIALIZE LOCAL MEDIA ==========
  useEffect(() => {
    // Only initialize if user has permission for camera OR mic
    if (!canUseCamera && !canUseMic && !isHost) {
      showToast('❌ You don\'t have permission to use camera or microphone', 'error');
      return;
    }

    const initMedia = async () => {
      try {
        const constraints = {
          video: canUseCamera,
          audio: canUseMic
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Only setup audio detection if mic is available
        if (canUseMic && stream.getAudioTracks().length > 0) {
          const audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          source.connect(analyser);
          
          const checkSpeaking = () => {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            
            if (average > 20 && !speakingUsers.includes(userId)) {
              setSpeakingUsers(prev => [...prev, userId]);
              socket?.emit('user-speaking', { roomId, userId, isSpeaking: true });
            } else if (average <= 20 && speakingUsers.includes(userId)) {
              setSpeakingUsers(prev => prev.filter(id => id !== userId));
              socket?.emit('user-speaking', { roomId, userId, isSpeaking: false });
            }
            requestAnimationFrame(checkSpeaking);
          };
          checkSpeaking();
        }
        
        const message = canUseCamera && canUseMic ? 'Camera and microphone access granted' 
                    : canUseCamera ? 'Camera access granted (Microphone disabled by teacher)'
                    : 'Microphone access granted (Camera disabled by teacher)';
        showToast(message);
        
      } catch (error) {
        console.error('Media access error:', error);
        showToast('Unable to access camera/microphone. Please check permissions.', 'warning');
      }
    };

    initMedia();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      Object.values(peerConnections.current).forEach(pc => pc.close());
    };
  }, []);

  // ========== CREATE PEER CONNECTIONS ==========
  useEffect(() => {
    if (!socket || !localStream || !roomId) return;
    
    participants.forEach(participant => {
      if (participant.id !== userId && !peerConnections.current[participant.id]) {
        createPeerConnection(participant.id);
      }
    });
  }, [participants, localStream, socket, roomId, userId]);

  const createPeerConnection = async (targetId) => {
    if (!localStream) return;
    
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    peerConnections.current[targetId] = pc;
    
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
    
    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({
        ...prev,
        [targetId]: event.streams[0]
      }));
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit('video-ice-candidate', {
          roomId,
          candidate: event.candidate,
          targetId,
          fromId: userId
        });
      }
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket?.emit('video-offer', {
      roomId,
      offer,
      targetId,
      fromId: userId
    });
  };

  // ========== TOGGLE AUDIO ==========
  const toggleAudio = () => {
    if (!canUseMic && !isHost) {
      showToast('🔴 Microphone is disabled by the teacher', 'warning');
      return;
    }
    
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const newMutedState = !isAudioMuted;
        audioTracks[0].enabled = !newMutedState;
        setIsAudioMuted(newMutedState);
        socket?.emit('audio-status', { roomId, userId, isMuted: newMutedState });
        showToast(newMutedState ? '🎤 Microphone muted' : '🎤 Microphone unmuted');
      } else {
        showToast('No microphone available', 'warning');
      }
    }
  };

  // ========== TOGGLE VIDEO ==========
  const toggleVideo = () => {
    if (!canUseCamera && !isHost) {
      showToast('🔴 Camera is disabled by the teacher', 'warning');
      return;
    }
    
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const newVideoState = !isVideoOff;
        videoTracks[0].enabled = !newVideoState;
        setIsVideoOff(newVideoState);
        socket?.emit('video-status', { roomId, userId, isOff: newVideoState });
        showToast(newVideoState ? '📹 Camera turned off' : '📹 Camera turned on');
      } else {
        showToast('No camera available', 'warning');
      }
    }
  };

  // ========== LEAVE CALL ==========
  const leaveCall = () => {
    socket?.emit('leave-video', { roomId, userId });
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    setLocalStream(null);
    setRemoteStreams({});
    setIsAudioMuted(false);
    setIsVideoOff(false);
    
    
    showToast('Left the video call');
  };

  // ========== RENDER VIDEO FEEDS ==========
  const allVideoFeeds = [
    { id: userId, name: currentUser?.name || 'You', isLocal: true, stream: localStream, isVideoOff },
    ...Object.entries(remoteStreams).map(([id, stream]) => ({
      id,
      name: participants.find(p => p.id === id)?.name || 'User',
      isLocal: false,
      stream,
      isVideoOff: false,
    
    }))
  ].slice(0, 6);

  return (
    <div className={`video-panel ${isMinimized ? 'minimized' : ''}`}>
      <div className="panel-header">
        <h3><i className="fas fa-video"></i> Video Call</h3>
        <div className="panel-controls">
          <button className="panel-btn" onClick={() => setIsMinimized(true)} title="Minimize">
            <FaWindowMinimize />
          </button>
          <button className="panel-btn" onClick={leaveCall} title="Leave Call">
            <FaTimes />
          </button>
        </div>
      </div>

      {!isMinimized ? (
        <div className="panel-content">
          {/* Permission Info Bar */}
          {!isHost && (!canUseMic || !canUseCamera) && (
            <div className="permission-warning">
              {!canUseMic && !canUseCamera && (
                <span>⚠️ Teacher has disabled both microphone and camera</span>
              )}
              {!canUseMic && canUseCamera && (
                <span>⚠️ Microphone disabled by teacher (View Only)</span>
              )}
              {canUseMic && !canUseCamera && (
                <span>⚠️ Camera disabled by teacher (Audio Only)</span>
              )}
            </div>
          )}

          {/* Video Grid */}
          <div className="video-grid">
            {allVideoFeeds.map(feed => (
              <div 
                key={feed.id} 
                className={`video-feed ${speakingUsers.includes(feed.id) ? 'speaking' : ''}`}
              >
                {feed.isLocal ? (
                  <>
                    <video 
                      ref={localVideoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className={feed.isVideoOff ? 'hidden' : ''} 
                    />
                    {feed.isVideoOff && (
                      <div className="no-video">
                        <i className="fas fa-user"></i>
                        <span>Camera off</span>
                      </div>
                    )}
                   
                  </>
                ) : (
                  <>
                    <video 
                      autoPlay 
                      playsInline 
                      srcObject={feed.stream} 
                    />
                  </>
                )}
                <div className="participant-label">
                  <span>
                    {feed.name}
                    {feed.isLocal && ' (You)'}
                    {participants.find(p => p.id === feed.id)?.role === 'teacher' && ' 👑'}
                    {!feed.isLocal && participants.find(p => p.id === feed.id)?.isMuted && (
                      <FaMicrophoneSlash className="mute-icon" />
                    )}
                    {feed.isLocal && isAudioMuted && <FaMicrophoneSlash className="mute-icon" />}
                  </span>
                </div>
              </div>
            ))}
            
            {/* Empty slots */}
            {allVideoFeeds.length < 4 && Array(4 - allVideoFeeds.length).fill(null).map((_, i) => (
              <div key={`empty-${i}`} className="video-feed empty-feed">
                <div className="no-video">
                  <i className="fas fa-user-plus"></i>
                  <span>Waiting for participants</span>
                </div>
              </div>
            ))}
          </div>

          {/* Video Controls - With Permission Checks */}
          <div className="video-controls">
            {/* Microphone Button */}
            <button 
              className={`control-btn ${isAudioMuted ? 'muted' : ''}`} 
              onClick={toggleAudio}
              disabled={!canUseMic && !isHost}
              title={!canUseMic && !isHost ? '🔴 Microphone disabled by teacher' : (isAudioMuted ? 'Unmute' : 'Mute')}
              style={{ opacity: (!canUseMic && !isHost) ? 0.5 : 1 }}
            >
              {isAudioMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
            </button>
            
            {/* Camera Button */}
            <button 
              className={`control-btn ${isVideoOff ? 'off' : ''}`} 
              onClick={toggleVideo}
              disabled={!canUseCamera && !isHost}
              title={!canUseCamera && !isHost ? '📹 Camera disabled by teacher' : (isVideoOff ? 'Turn on camera' : 'Turn off camera')}
              style={{ opacity: (!canUseCamera && !isHost) ? 0.5 : 1 }}
            >
              {isVideoOff ? <FaVideoSlash /> : <FaVideo />}
            </button>
            
            
           
            
            {/* Leave Call Button */}
            <button 
              className="control-btn leave-btn" 
              onClick={leaveCall}
              title="Leave video call"
            >
              <FaPhoneSlash />
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-icons">
          <div className="panel-icon" onClick={() => setIsMinimized(false)} title="Open video">
            <i className="fas fa-video"></i>
          </div>
          {isAudioMuted && (
            <div className="panel-icon muted-indicator" title="Microphone muted">
              <FaMicrophoneSlash />
            </div>
          )}
          {Object.keys(remoteStreams).length > 0 && (
            <div className="panel-icon" title={`${Object.keys(remoteStreams).length} active video`}>
              <span>{Object.keys(remoteStreams).length}</span>
            </div>
          )}
          
         
        </div>
      )}
    </div>
  );
};

export default VideoPanel;