const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Game = require('./GameLogic'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// --- 全局状态 ---
// games 依然存储所有房间的游戏逻辑： games['1001'] = new Game(...)
const games = {};         

io.on('connection', (socket) => {
    console.log('新玩家连接:', socket.id);

    // --- 1. 监听加入房间请求 ---
    socket.on('join_room', (roomId) => {
        // 获取该房间当前的 socket 信息
        // 注意：io.sockets.adapter.rooms 是一个 Map
        const room = io.sockets.adapter.rooms.get(roomId);
        const size = room ? room.size : 0;

        if (size === 0) {
            // A. 房间不存在 -> 创建房间，我是房主
            socket.join(roomId);
            socket.data.roomId = roomId; // 绑定房间号到 socket
            socket.emit('join_success', roomId);
            socket.emit('game_init', { msg: '等待对手加入...' });
            
        } else if (size === 1) {
            // B. 房间有1人 -> 加入房间，开始游戏
            socket.join(roomId);
            socket.data.roomId = roomId;
            socket.emit('join_success', roomId);

            // 获取对手的 socketId
            // room 是一个 Set，转换成数组取第一个就是对手
            const [opponentId] = room; 
            
            // 初始化游戏逻辑
            games[roomId] = new Game(opponentId, socket.id);
            const game = games[roomId];

            // 通知房间内所有人
            io.to(roomId).emit('game_init', { msg: '战斗开始！' });
            
            game.startGame();
            sendGameState(roomId);
            
            console.log(`房间 ${roomId} 战斗开始: ${opponentId} vs ${socket.id}`);

        } else {
            // C. 房间满员 -> 拒绝
            socket.emit('join_fail', '该房间已满员 (2/2)');
        }
    });

    // --- 2. 监听：移动指令 ---
    socket.on('move', (targetPos) => {
        const roomId = socket.data.roomId;
        if (!roomId || !games[roomId]) return; // 没进房间或者游戏没开始

        const game = games[roomId];
        if (game.status !== 'PLAYING') return;

        const result = game.move({
            playerId: socket.id,
            x: targetPos.x,
            y: targetPos.y
        });

        if (result.success) {
            sendGameState(roomId);
            if (result.type === 'combat') {
                io.to(roomId).emit('combat_effect', result.result);
            }
            if (game.winner) {
                io.to(roomId).emit('game_over', { winner: game.winner });
                delete games[roomId];
            }
        } else {
            socket.emit('error_msg', result.msg);
        }
    });

    // --- 3. 断开连接 ---
    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            // 如果游戏正在进行，通知对手
            if (games[roomId]) {
                io.to(roomId).emit('error_msg', '对方已断开连接，请刷新页面重新开始。');
                delete games[roomId];
            }
            console.log(`玩家离开房间 ${roomId}:`, socket.id);
        }
    });
});

function sendGameState(roomId) {
    const game = games[roomId];
    if (!game) return;

    io.in(roomId).fetchSockets().then(sockets => {
        sockets.forEach(playerSocket => {
            const personalizedData = game.getBoardForPlayer(playerSocket.id);
            playerSocket.emit('update_board', personalizedData);
        });
    });
}

server.listen(3000, () => {
    console.log('战棋服务器启动: http://localhost:3000');
});