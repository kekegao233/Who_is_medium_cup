// server.js

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Game = require('./GameLogic'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const games = {};         

io.on('connection', (socket) => {
    console.log('新玩家连接:', socket.id);

    // --- 1. 加入房间 ---
    socket.on('join_room', (data) => {
        const roomId = (typeof data === 'object') ? data.roomId : data;
        const nickname = (typeof data === 'object') ? data.nickname : '神秘人';
        socket.data.nickname = nickname;

        const room = io.sockets.adapter.rooms.get(roomId);
        const size = room ? room.size : 0;

        if (size === 0) {
            socket.join(roomId);
            socket.data.roomId = roomId; 
            socket.emit('join_success', roomId);
            socket.emit('game_init', { msg: `你好 ${nickname}，等待对手...` });
        } else if (size === 1) {
            socket.join(roomId);
            socket.data.roomId = roomId;
            socket.emit('join_success', roomId);
            const [opponentId] = room; 
            const opponentSocket = io.sockets.sockets.get(opponentId);
            const opponentName = opponentSocket ? opponentSocket.data.nickname : '对手';
            
            games[roomId] = new Game(opponentId, opponentName, socket.id, nickname);
            const game = games[roomId];
            
            io.to(roomId).emit('game_init', { msg: '战斗开始！' });
            game.startGame();
            sendGameState(roomId);
        } else {
            socket.emit('join_fail', '该房间已满员 (2/2)');
        }
    });

    // --- 2. 移动与攻击处理 ---
    socket.on('move', (targetPos) => {
        const roomId = socket.data.roomId;
        if (!roomId || !games[roomId]) return; 
        const game = games[roomId];

        const result = game.move({
            playerId: socket.id,
            x: targetPos.x, y: targetPos.y
        });

        if (result.success) {
            sendGameState(roomId);

            if (result.type === 'pending_reaction') {
                const defenderSocketId = result.defenderOwner;
                io.to(defenderSocketId).emit('skill_reaction_request', { type: 've_reject' });
                io.to(roomId).emit('skill_log', result.msg);
                return; 
            }
            
            if (result.type === 'pending_a2_choice') {
                io.to(roomId).emit('combat_effect', result.combatResult);
                const attackerSocketId = result.attackerOwner;
                setTimeout(() => {
                    io.to(attackerSocketId).emit('skill_reaction_request', { type: 'a2_regret' });
                }, 1500);
                return;
            }

            if (result.type === 'combat') {
                io.to(roomId).emit('combat_effect', result.result);
            }
            
            if (result.specialLog) {
                io.to(roomId).emit('skill_log', result.specialLog);
            }

            checkGameOver(roomId, game);

        } else {
            if (result.isTaunt) {
                const playerNick = socket.data.nickname || "玩家";
                io.to(roomId).emit('skill_log', `⚠️ ${playerNick} 试图攻击，但被 [${result.taunter}] 嘲讽了！`);
            }
            socket.emit('error_msg', result.msg);
        }
    });

    // --- 3. 处理技能响应 ---
    socket.on('resolve_duel', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !games[roomId]) return; 
        const game = games[roomId];
        
        const decision = data.accept ? 'accept' : 'reject';
        const result = game.resolveReaction(socket.id, decision);

        if (result.success) {
            sendGameState(roomId);
            if (result.reacted) {
                io.to(roomId).emit('skill_log', result.log);
            } else if (result.type === 'combat') {
                 io.to(roomId).emit('skill_log', "🛡️ [VE] 接受了挑战！");
                 io.to(roomId).emit('combat_effect', result.result);
            }
            checkGameOver(roomId, game);
        }
    });

    socket.on('resolve_a2_regret', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || !games[roomId]) return; 
        const game = games[roomId];
        const result = game.resolveA2Regret(socket.id, data.regret);
        if (result.success) {
            sendGameState(roomId);
            if (result.publicMsg) {
                io.to(roomId).emit('skill_log', result.publicMsg);
            }
            checkGameOver(roomId, game);
        }
    });

    // --- 5. 主动技能 ---
    socket.on('use_skill', (targetPos) => {
        const roomId = socket.data.roomId;
        if (!roomId || !games[roomId]) return; 
        const game = games[roomId];

        const result = game.useSkill({
            playerId: socket.id,
            x: targetPos.x, y: targetPos.y,
            allyX: targetPos.allyX, 
            allyY: targetPos.allyY
        });

        if (result.success) {
            if (result.publicMsg) io.to(roomId).emit('skill_log', result.publicMsg);
            if (result.privateMsg) socket.emit('skill_log', `🕵️ ${result.privateMsg}`); 
            if (result.consumeTurn) {
                game.endTurn();
            }
            sendGameState(roomId);
            checkGameOver(roomId, game);
        } else {
            socket.emit('error_msg', result.msg);
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId && games[roomId]) {
            io.to(roomId).emit('error_msg', '对方已断开连接，游戏结束。');
            delete games[roomId];
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

function checkGameOver(roomId, game) {
    if (game.winner) {
        const winnerName = game.playerNames[game.winner];
        io.to(roomId).emit('game_over', { winner: game.winner, winnerName: winnerName });
        delete games[roomId]; 
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`游戏服务器启动，监听端口: ${PORT}`);
});