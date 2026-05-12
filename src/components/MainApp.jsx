import React, { useState, useEffect, useRef } from 'react';
import { FaUsers, FaTerminal, FaVideo, FaRobot, FaUserPlus, FaStop, FaDownload, FaUpload, FaSignOutAlt } from 'react-icons/fa';
import io from 'socket.io-client';
import SidebarPanel from './SidebarPanel';
import Editor from './Editor';
import OutputPanel from './OutputPanel';
import VideoPanel from './VideoPanel';
import Chatbot from './Chatbot';
import InviteModal from './InviteModal';
import './MainApp.css';

const MainApp = ({ user, role, currentRoom, onLogout, showToast }) => {
  const [panels, setPanels] = useState({
    sidebar: true,
    output: true,
    video: true
  });
  const [showChatbot, setShowChatbot] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  // IMPORTANT: Role check
  const isTeacher = role === 'teacher' || role === 'host';
  const isStudent = role === 'student';

  // Get room permissions (what teacher allowed)
  const roomPermissions = currentRoom?.permissions || {
    editCode: false,
    viewOnly: true,
    useMicrophone: true,
    useCamera: true,
    downloadCode: false
  };

  // Socket connection 
  useEffect(() => {
    if (!currentRoom?.id) return;

    const newSocket = io('http://localhost:5000', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      showToast('Connected to collaboration server');
      
      newSocket.emit('join-room', {
        roomId: currentRoom.id,
        user: {
          id: user?.id || Date.now().toString(),
          name: user?.name || 'User',
          role: role,
          permissions: roomPermissions,
          avatar: (user?.name || 'U').charAt(0).toUpperCase()
        }
      });
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      showToast('Disconnected from server', 'error');
    });

    newSocket.on('room-data', (data) => {
      setParticipants(data.participants || []);
      if (editorRef.current && data.code) {
        editorRef.current.setValue(data.code);
      }
    });

    newSocket.on('participants-update', (data) => {
      setParticipants(data.participants);
    });

    newSocket.on('user-joined', (data) => {
      setParticipants(prev => [...prev, data.user]);
      showToast(`${data.user.name} joined the room`);
    });

    newSocket.on('user-left', (data) => {
      setParticipants(prev => prev.filter(p => p.id !== data.userId));
      showToast('A user left the room');
    });

    newSocket.on('code-update', (data) => {
      if (editorRef.current && data.userId !== newSocket.id) {
        editorRef.current.setValue(data.code);
      }
    });

    newSocket.on('room-ended', () => {
      showToast('Room has been ended by the host', 'warning');
      setTimeout(() => onLogout(), 2000);
    });

    setSocket(newSocket);

    return () => {
      if (newSocket) {
        newSocket.emit('leave-room', { roomId: currentRoom.id, userId: user?.id });
        newSocket.close();
      }
    };
  }, [currentRoom, user, role]);

  const togglePanel = (panel) => {
    setPanels(prev => ({ ...prev, [panel]: !prev[panel] }));
  };

  const handleEndRoom = () => {
    if (!isTeacher) {
      showToast('Only teachers can end the room', 'warning');
      return;
    }
    if (window.confirm('Are you sure you want to end this room?')) {
      if (socket && isConnected) {
        socket.emit('end-room', { roomId: currentRoom?.id });
      }
      localStorage.removeItem('currentRoom');
      onLogout();
      showToast('Room ended successfully');
    }
  };

  const handleDownloadCode = () => {
    // Student can only download if teacher allowed
    if (isStudent && !roomPermissions.downloadCode) {
      showToast('Download is disabled by the teacher', 'warning');
      return;
    }
    
    const currentCode = editorRef.current?.getValue();
    if (!currentCode) {
      showToast('No code to download');
      return;
    }
    
    const blob = new Blob([currentCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `collabcode_${currentRoom?.id}_${Date.now()}.js`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Code downloaded successfully');
  };

  const handleFileUpload = (event) => {
    // Only teachers can upload
    if (!isTeacher) {
      showToast('Only teachers can upload code files', 'warning');
      return;
    }
    
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const uploadedCode = e.target.result;
      if (editorRef.current) {
        editorRef.current.setValue(uploadedCode);
      }
      if (socket && isConnected && currentRoom?.id) {
        socket.emit('code-change', {
          roomId: currentRoom.id,
          code: uploadedCode,
          userId: user?.id,
          userName: user?.name,
          fileName: file.name
        });
        showToast(`Uploaded and shared ${file.name}`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLeaveRoom = () => {
    if (window.confirm('Are you sure you want to leave this room?')) {
      if (socket && isConnected) {
        socket.emit('leave-room', { roomId: currentRoom?.id, userId: user?.id });
      }
      onLogout(); 
      showToast('Left the room');
    }
  };

  //  student logout from dropdown
  const handleStudentLogout = () => {
    if (window.confirm('Are you sure you want to logout?')) {
      if (socket && isConnected && currentRoom?.id) {
        socket.emit('leave-room', { roomId: currentRoom?.id, userId: user?.id });
      }
      onLogout();
      showToast('Logged out successfully');
    }
  };

  const onlineCount = participants.filter(p => p.isOnline !== false).length;

  return (
    <div className="main-app">
      <header className="app-header">
        <div className="logo">
          <i className="fas fa-code"></i>
          <span>CollabCode {currentRoom ? `- ${currentRoom.name}` : ''}</span>
          {isStudent && (
            <span className="role-badge student">
              👨‍🎓 Student  {!roomPermissions.editCode}
            </span>
          )}
          {isTeacher && <span className="role-badge teacher"> 👨‍🏫 Teacher </span>}
        </div>
        
        <div className="room-id-display">
          ID: <strong>{currentRoom?.id}</strong>
        </div>

        <div className="header-controls">
          <div className="connection-status">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
            <span>{isConnected ? 'Live' : 'Offline'}</span>
            {isConnected && onlineCount > 0 && (
              <span className="participants-count">👥 {onlineCount}</span>
            )}
          </div>

          <div className="panel-controls">
            <button className={`panel-toggle ${panels.sidebar ? 'active' : ''}`} onClick={() => togglePanel('sidebar')}>
              <FaUsers />
            </button>
            <button className={`panel-toggle ${panels.output ? 'active' : ''}`} onClick={() => togglePanel('output')}>
              <FaTerminal />
            </button>
            <button className={`panel-toggle ${panels.video ? 'active' : ''}`} onClick={() => togglePanel('video')}>
              <FaVideo />
            </button>
            <button className={`panel-toggle ${showChatbot ? 'active' : ''}`} onClick={() => setShowChatbot(!showChatbot)}>
              <FaRobot />
            </button>
          </div>

          {/* ========== TEACHER ONLY BUTTONS ========== */}
          {isTeacher && (
            <>
              <button className="btn btn-outline" onClick={() => setShowInviteModal(true)}>
                <FaUserPlus /> Invite
              </button>
              <button className="btn btn-danger" onClick={handleEndRoom}>
                <FaStop /> End Room
              </button>
              <button className="btn btn-outline" onClick={handleDownloadCode}>
                <FaDownload /> Download
              </button>
              <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()}>
                <FaUpload /> Upload
              </button>
            </>
          )}

          {/* ========== STUDENT ONLY BUTTONS (based on permissions) ========== */}
          {isStudent && (
            <>
              {roomPermissions.downloadCode && (
                <button className="btn btn-outline" onClick={handleDownloadCode}>
                  <FaDownload /> Download
                </button>
              )}
              <button className="btn btn-outline" onClick={handleLeaveRoom}>
                <FaSignOutAlt /> Leave Room
              </button>
            </>
          )}

          {/* ========== USER INFO ========== */}
          <div className="user-info">
            <div className="user-avatar">{user?.avatar || (isTeacher ? 'T' : 'S')}</div>
            <span className="user-name">{user?.name || 'User'}</span>
            <div className="user-dropdown">
            
              <div className="dropdown-item" onClick={isTeacher ? onLogout : handleStudentLogout}>
                <i className="fas fa-sign-out-alt"></i> Logout
              </div>
            </div>
          </div>
        </div>
      </header>

      <input ref={fileInputRef} type="file" style={{ display: 'none' }} accept=".js,.jsx,.ts,.tsx,.html,.css,.json,.txt,.py,.java" onChange={handleFileUpload} />

      <div className="main-container">
        {panels.sidebar && (
          <SidebarPanel 
            participants={participants}
            role={role}
            showToast={showToast}
            socket={socket}
            roomId={currentRoom?.id}
            user={user}
            isTeacher={isTeacher}
            roomPermissions={roomPermissions}
          />
        )}

        <Editor 
          ref={editorRef}
          user={user}
          role={role}
          showToast={showToast}
          socket={socket}
          roomId={currentRoom?.id}
          isTeacher={isTeacher}
          roomPermissions={roomPermissions}
        />

        {panels.output && <OutputPanel showToast={showToast} />}

        {panels.video && (
          <VideoPanel 
            participants={participants}
            role={role}
            showToast={showToast}
            socket={socket}
            roomId={currentRoom?.id}
            currentUser={user}
            isTeacher={isTeacher}
            roomPermissions={roomPermissions}
          />
        )}
      </div>

      <div className="app-footer">
        <div className="connection-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
          <span>{isConnected ? 'Connected' : 'Connecting...'}</span>
          {isConnected && onlineCount > 0 && <span>👥 {onlineCount} online</span>}
        </div>
        <div className="copyright">
          {isStudent && !roomPermissions.editCode 
            ? '©  KYA-CollabCode - Student Mode'
            : isStudent 
              ? '©  KYA-CollabCode - Student Mode'
              : '©  KYA-CollabCode - Teacher Mode'}
        </div>
      </div>

      {showChatbot && <Chatbot onClose={() => setShowChatbot(false)} />}
      {showInviteModal && isTeacher && (
        <InviteModal room={currentRoom} onClose={() => setShowInviteModal(false)} showToast={showToast} />
      )}
    </div>
  );
};

export default MainApp;