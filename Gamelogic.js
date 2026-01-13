// GameLogic.js - 3.0版本 (新地图+视野修正)

// --- 20人英雄池 ---
const CHARACTERS = [
    { id: 'c1', name: '狂战', desc: '周围有敌人时攻击力增加' },
    { id: 'c2', name: '刺客', desc: '可以跨越障碍移动' },
    { id: 'c3', name: '圣骑', desc: '替周围友军分担伤害' },
    { id: 'c4', name: '猎人', desc: '攻击距离+1' },
    { id: 'c5', name: '法师', desc: '范围爆炸伤害' },
    { id: 'c6', name: '牧师', desc: '复活一名友军' },
    { id: 'c7', name: '死灵', desc: '召唤骷髅兵' },
    { id: 'c8', name: '盗贼', desc: '偷取敌人技能' },
    { id: 'c9', name: '盾卫', desc: '免疫一次致命伤' },
    { id: 'c10', name: '先知', desc: '查看任意一张暗牌' },
    { id: 'c11', name: '德鲁伊', desc: '变换形态' },
    { id: 'c12', name: '萨满', desc: '放置图腾' },
    { id: 'c13', name: '龙骑', desc: '飞跃移动' },
    { id: 'c14', name: '武僧', desc: '击退敌人' },
    { id: 'c15', name: '术士', desc: '诅咒敌人降低等级' },
    { id: 'c16', name: '游侠', desc: '移动后可再次攻击' },
    { id: 'c17', name: '炼金', desc: '随机改变场上地形' },
    { id: 'c18', name: '吟游', desc: '全体友军加速' },
    { id: 'c19', name: '魔剑', desc: '根据血量造成伤害' },
    { id: 'c20', name: '幻术', desc: '交换两个棋子的位置' }
];

// --- 称号系统 ---
const RANK_NAMES = {
    1: "中杯", 2: "中杯圆满", 3: "大杯", 4: "超大杯", 5: "星球杯", 6: "十翅桶", 7: "新神已至"
};

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

class Game {
    constructor(player1Id, player2Id) {
        this.players = { [player1Id]: 'A', [player2Id]: 'B' };
        this.board = Array(7).fill(null).map(() => Array(7).fill(null));
        this.pieces = {};
        this.actionQueues = { A: [], B: [] }; 
        this.currentPointers = { A: 0, B: 0 }; 
        this.activeTeam = null; 
        this.status = 'SETUP'; 
        this.winner = null;
        this.initPieces(player1Id, player2Id);
    }

    initPieces(p1, p2) {
        const shuffledChars = shuffle([...CHARACTERS]); 
        const teamAChars = shuffledChars.slice(0, 7);   
        const teamBChars = shuffledChars.slice(7, 14);  
        const ranksA = shuffle([1, 2, 3, 4, 5, 6, 7]);
        const ranksB = shuffle([1, 2, 3, 4, 5, 6, 7]);

        teamAChars.forEach((c, i) => this.createPiece(p1, 'A', c, ranksA[i], i, 0));
        teamBChars.forEach((c, i) => this.createPiece(p2, 'B', c, ranksB[i], i, 6));
    }

    createPiece(playerId, team, charConfig, rank, x, y) {
        const id = `${team}-slot-${x}`; 
        const piece = {
            id: id, team: team, owner: playerId,
            x: x, y: y, isDead: false,
            rank: rank, rankTitle: RANK_NAMES[rank],
            charName: charConfig.name, charDesc: charConfig.desc, skillId: charConfig.id,   
            maxUses: 1, currentUses: 0
        };
        this.pieces[id] = piece;
        this.board[y][x] = piece;
    }

    startGame() {
        if (this.status !== 'SETUP') return;
        this.actionQueues.A = shuffle(Object.values(this.pieces).filter(p => p.team === 'A').map(p => p.id));
        this.actionQueues.B = shuffle(Object.values(this.pieces).filter(p => p.team === 'B').map(p => p.id));
        this.activeTeam = Math.random() > 0.5 ? 'A' : 'B';
        this.status = 'PLAYING';
    }

    getCurrentTurnInfo() {
        if (this.winner) return null;
        const team = this.activeTeam;
        const queue = this.actionQueues[team];
        let ptr = this.currentPointers[team];
        let attempts = 0;
        let activePiece = null;

        while (attempts < 7) { 
            const piece = this.pieces[queue[ptr]];
            if (!piece.isDead) { activePiece = piece; break; }
            ptr = (ptr + 1) % 7;
            this.currentPointers[team] = ptr; 
            attempts++;
        }

        if (!activePiece) return null; 

        return {
            activePieceId: activePiece.id,
            team: activePiece.team,      
            rank: activePiece.rank,
            rankTitle: activePiece.rankTitle,
            name: activePiece.charName,
            x: activePiece.x, y: activePiece.y
        };
    }

    move(playerRequest) {
        const turnInfo = this.getCurrentTurnInfo();
        if (!turnInfo) return { success: false, msg: "游戏结束" };
        const piece = this.pieces[turnInfo.activePieceId];

        if (playerRequest.playerId !== piece.owner) return { success: false, msg: "不归你管" };
        if (!this.isValidPath(piece.x, piece.y, playerRequest.x, playerRequest.y)) return { success: false, msg: "路径不通" };

        const targetCell = this.board[playerRequest.y][playerRequest.x];
        let result = { success: true };

        if (!targetCell) {
            this.updateBoardPosition(piece, playerRequest.x, playerRequest.y);
            result.type = 'move';
        } else if (targetCell.team === piece.team) {
            return { success: false, msg: "不能踩队友" };
        } else {
            result.type = 'combat';
            result.result = this.resolveCombat(piece, targetCell);
        }

        this.currentPointers[this.activeTeam] = (this.currentPointers[this.activeTeam] + 1) % 7;
        this.activeTeam = (this.activeTeam === 'A' ? 'B' : 'A');
        return result;
    }

    // --- 核心：新地图逻辑 ---
    // 这里只负责判断“能不能走过去”（斜线或直线），具体的红色样式由前端画
// --- 核心：新地图逻辑 (根据你的坐标描述) ---
    isValidPath(x1, y1, x2, y2) {
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        
        // 1. 基础物理法则：允许走直线 (包括红色直线和普通黑线)
        if (dx + dy === 1) return true;

        // 2. 斜线逻辑 (dx=1, dy=1)
        // 只有在红色斜线上的两点，才允许斜着走
        if (dx === 1 && dy === 1) {
            const pair = [x1, y1, x2, y2].join(',');
            const revPair = [x2, y2, x1, y1].join(',');
            
            // 我们把你描述的长斜线拆解成单步 (1格)
            const validDiagonalSteps = [
                // --- 左上角 X型 ---
                // (0,0)->(2,2) 拆解
                "0,0,1,1", "1,1,2,2",
                // (2,0)->(0,2) 拆解
                "2,0,1,1", "1,1,0,2",

                // --- 左下角 ---
                // (2,2)->(0,4) 拆解
                "2,2,1,3", "1,3,0,4",
                // (2,6)->(1,5) 短斜线
                "2,6,1,5",

                // --- 右上角 ---
                // (3,0)->(4,1) 短斜线
                "3,0,4,1",

                // --- 右下角 ---
                // (3,3)->(6,6) 长斜线拆解
                "3,3,4,4", "4,4,5,5", "5,5,6,6",
                // (3,6)->(4,5) 短斜线
                "3,6,4,5",
                // (5,3)->(4,4) 连接线
                "5,3,4,4"
            ];

            if (validDiagonalSteps.includes(pair) || validDiagonalSteps.includes(revPair)) return true;
        }
        return false;
    }

    resolveCombat(attacker, defender) {
        const aRank = attacker.rank;
        const dRank = defender.rank;
        let winner = null; 
        if (aRank === 1 && dRank === 7) winner = 'attacker';
        else if (aRank === 7 && dRank === 1) winner = 'defender';
        else if (aRank === dRank) winner = 'draw';
        else winner = aRank > dRank ? 'attacker' : 'defender';

        if (winner === 'attacker') {
            this.killPiece(defender);
            this.updateBoardPosition(attacker, defender.x, defender.y); 
        } else if (winner === 'defender') {
            this.killPiece(attacker);
        } else {
            this.killPiece(attacker);
            this.killPiece(defender);
            this.board[defender.y][defender.x] = null;
        }
        this.checkWinCondition();
        return { winner, attackerRank: attacker.rankTitle, defenderRank: defender.rankTitle };
    }

    killPiece(piece) {
        piece.isDead = true;
        if (this.board[piece.y][piece.x] === piece) this.board[piece.y][piece.x] = null;
    }

    updateBoardPosition(piece, newX, newY) {
        this.board[piece.y][piece.x] = null;
        piece.x = newX;
        piece.y = newY;
        this.board[newY][newX] = piece;
    }

    checkWinCondition() {
        const teamAAlive = Object.values(this.pieces).some(p => p.team === 'A' && !p.isDead);
        const teamBAlive = Object.values(this.pieces).some(p => p.team === 'B' && !p.isDead);
        if (!teamAAlive) this.winner = 'B';
        if (!teamBAlive) this.winner = 'A';
    }

    getBoardForPlayer(playerId) {
        const playerTeam = this.players[playerId]; 
        const visiblePieces = [];
        Object.values(this.pieces).forEach(p => {
            if (p.isDead) return;
            visiblePieces.push({
                x: p.x, y: p.y, team: p.team,
                name: p.charName, desc: p.charDesc,        
                id: p.team === playerTeam ? p.id : undefined 
            });
        });

        const buildQueueData = (team) => {
            return this.actionQueues[team].map(pid => {
                const p = this.pieces[pid];
                const isMine = (team === playerTeam);
                const isCurrent = (this.getCurrentTurnInfo()?.activePieceId === pid);
                return {
                    name: p.charName,
                    rankTitle: isMine ? p.rankTitle : '???', 
                    isDead: p.isDead,
                    isCurrent: isCurrent
                };
            });
        };

        // --- 核心修正：顶部状态栏脱敏 ---
        // 如果当前行动的人不是我，把rankTitle掩盖掉
        let currentTurn = this.getCurrentTurnInfo();
        if (currentTurn && currentTurn.team !== playerTeam) {
            // 复制一份对象，以免修改到底层数据
            currentTurn = { 
                ...currentTurn, 
                rankTitle: '???', // 隐藏等级
                // name: '???'    // 如果你想连名字都隐藏，可以把这行解注
            };
        }

        return {
            board: visiblePieces,
            status: this.status,
            turn: currentTurn, 
            winner: this.winner,
            queues: { A: buildQueueData('A'), B: buildQueueData('B') },
            myTeam: playerTeam
        };
    }
}
module.exports = Game;