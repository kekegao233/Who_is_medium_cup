// GameLogic.js

const CHARACTERS = [
    { id: 'wolf', name: '血狼破军', desc: '舔断兔腿：周围有卡特斯移动增加；方舟一区：嘲讽敌方攻击', tags: { isStarch: true } },
    { id: 'silverash', name: '银灰', desc: '鹰眼视觉：行动前可查看周围敌方等级 (2次)', tags: {} },
    { id: 'mlynar', name: '玛恩纳', desc: '看报纸：不动则等级+1 (最高星球杯)', tags: {} },
    { id: 'amiya', name: '阿米娅', desc: '奇美拉：无视等级攻击一次 (1次)', tags: { isCautus: true } },
    { id: 'mensa', name: '门萨鸭', desc: '考核期：指定敌方进入考核；下回合轮到自己时自动与其决斗 (1次)', tags: { isStarch: true } },
    { id: 'huaqi', name: '华亓', desc: '圆周率：无视格线，向周围八格任意移动', tags: { isStarch: true } },
    { id: 'fanji', name: '反季雪', desc: '败犬：死亡时对周围所有敌方发起决斗 (被沉默时无效)', tags: { isStarch: true } },
    { id: 've', name: 'VE', desc: '自闭忍宗：孤狼时必胜；反驳型人格：被攻击时可拒绝一次决斗 (被沉默时无效)', tags: { isStarch: true } },
    { id: 'ray', name: '莱伊', desc: '沙地兽：全图决斗 (1次，不可移动)', tags: { isCautus: true } },
    { id: 'ycyx', name: '三笙', desc: '我喜欢你：指定周围一圈敌方“禁魔”(无法使用主动/被动技能) 1回合', tags: {} },
    { id: 'yellow', name: '黄头', desc: '反头派清洗：对全场敌方“淀粉”角色发起决斗，不死不休 (1次)', tags: {} },
    { id: 'dragon', name: '龙哥哥', desc: '破碎大道(AOE) / 鲜蔬杯(指定周围一敌一友决斗) (1次)', tags: { isStarch: true } },
    { id: 'a2', name: 'A2', desc: '被动：跳跃队友；主动：左右互搏(未获胜时可悔棋，1次)', tags: { isStarch: true } },
    { id: 'zhipao', name: '只炮', desc: '魔术师：与队友换位(1次)；热情：每3回合回血；羁绊：超棒三兄弟', tags: { isStarch: true } }
];

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
    constructor(player1Id, player1Name, player2Id, player2Name) {
        this.players = { [player1Id]: 'A', [player2Id]: 'B' };
        this.playerNames = { 'A': player1Name, 'B': player2Name };
        this.board = Array(7).fill(null).map(() => Array(7).fill(null));
        this.pieces = {};
        this.actionQueues = { A: [], B: [] }; 
        this.currentPointers = { A: 0, B: 0 }; 
        this.activeTeam = null; 
        this.status = 'SETUP'; 
        this.winner = null;
        this.systemLogs = []; 
        this.pendingDecision = null; 
        
        this.a2Snapshot = null;
        this.dragonA2Seq = 0; // 317羁绊计数器
        
        this.initPieces(player1Id, player2Id);
    }

    initPieces(p1, p2) {
        const pool = [...CHARACTERS];
        while (pool.length < 14) pool.push({ ...pool[0], id: pool[0].id + '_copy' });
        const shuffledChars = shuffle(pool); 
        const teamAChars = shuffledChars.slice(0, 7);   
        const teamBChars = shuffledChars.slice(7, 14);  
        const ranksA = shuffle([1, 2, 3, 4, 5, 6, 7]);
        const ranksB = shuffle([1, 2, 3, 4, 5, 6, 7]);

        let positionsA = [];
        for (let y = 0; y <= 2; y++) for (let x = 0; x <= 6; x++) positionsA.push({x, y});
        positionsA = shuffle(positionsA);

        let positionsB = [];
        for (let y = 4; y <= 6; y++) for (let x = 0; x <= 6; x++) positionsB.push({x, y});
        positionsB = shuffle(positionsB);

        teamAChars.forEach((c, i) => {
            this.createPiece(p1, 'A', c, ranksA[i], positionsA[i].x, positionsA[i].y);
        });
        teamBChars.forEach((c, i) => {
            this.createPiece(p2, 'B', c, ranksB[i], positionsB[i].x, positionsB[i].y);
        });

        // --- 阵营羁绊修正：狙神 (Sniper God) ---
        ['A', 'B'].forEach(team => {
            const teamPieces = Object.values(this.pieces).filter(p => p.team === team);
            const hasRay = teamPieces.find(p => p.skillId === 'ray');
            const hasFanji = teamPieces.find(p => p.skillId === 'fanji');
            
            if (hasRay && hasFanji) {
                hasRay.maxSkillUses += 1; // 莱伊子弹+1
                hasRay.charDesc += " [狙神:子弹+1]";
            }
        });
    }

    createPiece(playerId, team, charConfig, rank, x, y) {
        const id = `${team}-slot-${x}-${y}`; 
        
        // 基础技能次数设定
        let baseUses = 0;
        if (['silverash', 'mensa', 'ycyx'].includes(charConfig.id)) baseUses = 2;
        // 莱伊默认1，如果是狙神在 initPieces 里会+1；只炮也是1
        else if (['amiya', 've', 'ray', 'yellow', 'dragon', 'a2', 'zhipao'].includes(charConfig.id)) baseUses = 1;

        const piece = {
            id: id, team: team, owner: playerId,
            x: x, y: y, isDead: false,
            rank: rank, rankTitle: RANK_NAMES[rank],
            charName: charConfig.name, charDesc: charConfig.desc, 
            skillId: charConfig.id, tags: charConfig.tags || {}, 
            hp: 2, maxHp: 2,
            maxSkillUses: baseUses,
            currentSkillUses: 0,
            revealedTo: [],
            isChimeraActive: false,
            isFrozen: false, 
            isVulnerable: false,
            isSilenced: false,
            
            // 门萨鸭专用：记录锁定的目标ID
            mensaTargetId: null,
            // 只炮专用：行动计数
            zhipaoTurnCount: 0
        };
        this.pieces[id] = piece;
        this.board[y][x] = piece;
    }

    // --- 核心方法：统一伤害处理 (含 超棒三兄弟 逻辑) ---
    applyDamage(source, target, amount) {
        if (target.isDead) return;

        let finalTarget = target;
        let logPrefix = "";

        // 检测【超棒三兄弟】羁绊: 华亓(huaqi), VE(ve), 门萨鸭(mensa)
        const brothers = ['huaqi', 've', 'mensa'];
        if (brothers.includes(target.skillId)) {
            // 寻找同队存活的其他兄弟
            const teammates = Object.values(this.pieces).filter(p => 
                p.team === target.team && 
                !p.isDead && 
                p.id !== target.id && 
                brothers.includes(p.skillId)
            );

            // 50% 概率转移伤害
            if (teammates.length > 0 && Math.random() < 0.5) {
                const luckyOne = teammates[Math.floor(Math.random() * teammates.length)];
                finalTarget = luckyOne;
                logPrefix = `🛡️ [超棒三兄弟] 触发！伤害从 [${target.charName}] 转移到了 [${finalTarget.charName}] 身上！<br>`;
            }
        }

        finalTarget.hp -= amount;

        if (logPrefix) {
            this.systemLogs.push(logPrefix);
            if (finalTarget.hp <= 0) {
                 this.systemLogs.push(`💔 [${finalTarget.charName}] 替队友挡刀身亡！`);
            }
        }

        if (finalTarget.hp <= 0) {
            this.killPiece(finalTarget);
        }
    }

    // --- 核心方法：回合开始钩子 (含 317羁绊 & 只炮回血) ---
    onTurnStart(piece) {
        if (!piece || piece.isDead) return;

        // 1. 只炮：热情
        if (piece.skillId === 'zhipao') {
            piece.zhipaoTurnCount = (piece.zhipaoTurnCount || 0) + 1;
            if (piece.zhipaoTurnCount % 3 === 0) {
                if (piece.hp < piece.maxHp) {
                    piece.hp += 1;
                    this.systemLogs.push(`❤️ [只炮] 对明日方舟保持热情，HP +1 (当前: ${piece.hp})`);
                }
            }
        }

        // 2. 317羁绊 (龙哥哥 + A2)
        if (piece.skillId === 'dragon' || piece.skillId === 'a2') {
            const partnerId = (piece.skillId === 'dragon') ? 'a2' : 'dragon';
            const partner = Object.values(this.pieces).find(p => p.skillId === partnerId && p.team === piece.team && !p.isDead);

            let isAdjacent = false;
            if (partner) {
                const dx = Math.abs(piece.x - partner.x);
                const dy = Math.abs(piece.y - partner.y);
                // 周围4格 (曼哈顿距离=1)
                if (dx <= 1 && dy <= 1) {
                    isAdjacent = true;
                }
            }

            if (isAdjacent) {
                this.dragonA2Seq++;
                // 连续两次检测到相邻 (以任意一人回合开始计数)
                if (this.dragonA2Seq >= 2) {
                    this.systemLogs.push(`⚡ [317羁绊] 触发！龙哥哥和A2贴贴太久了，两败俱伤！`);
                    
                    // 双方扣血 (此处暂设定为不触发三兄弟转移，视为直接流失)
                    piece.hp -= 1;
                    if (piece.hp <= 0) this.killPiece(piece);

                    if (partner) {
                        partner.hp -= 1;
                        if (partner.hp <= 0) this.killPiece(partner);
                    }
                    this.dragonA2Seq = 0; // 重置
                }
            } else {
                this.dragonA2Seq = 0; // 不相邻则断掉
            }
        }
    }

    // --- 辅助函数：检测特定Tag ---
    checkNearbyForTag(x, y, tagName, team) {
        const directions = [ { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 } ];
        for (let dir of directions) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (nx >= 0 && nx <= 6 && ny >= 0 && ny <= 6) {
                const target = this.board[ny][nx];
                if (target && target.team === team) {
                    if (target.tags && target.tags[tagName]) return true;
                }
            }
        }
        return false;
    }

    startGame() {
        if (this.status !== 'SETUP') return;
        this.actionQueues.A = shuffle(Object.values(this.pieces).filter(p => p.team === 'A').map(p => p.id));
        this.actionQueues.B = shuffle(Object.values(this.pieces).filter(p => p.team === 'B').map(p => p.id));
        this.activeTeam = Math.random() > 0.5 ? 'A' : 'B';
        this.status = 'PLAYING';
        
        // 游戏开始，检查第一个行动者的 onTurnStart
        const turnInfo = this.getCurrentTurnInfo();
        if (turnInfo) {
            this.onTurnStart(this.pieces[turnInfo.activePieceId]);
        }
        
        this.checkAndSkipIfStuck(this.activeTeam);
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
            activePieceId: activePiece.id, team: activePiece.team, 
            rank: activePiece.rank, rankTitle: activePiece.rankTitle, 
            name: activePiece.charName, x: activePiece.x, y: activePiece.y
        };
    }

    endTurn() {
        const prevTurnInfo = this.getCurrentTurnInfo();
        if (prevTurnInfo) {
            const piece = this.pieces[prevTurnInfo.activePieceId];
            if (piece && piece.isSilenced) piece.isSilenced = false;
        }

        this.currentPointers[this.activeTeam] = (this.currentPointers[this.activeTeam] + 1) % 7;
        this.activeTeam = (this.activeTeam === 'A' ? 'B' : 'A');
        
        const nextTurnInfo = this.getCurrentTurnInfo();
        if (nextTurnInfo) {
            const nextPiece = this.pieces[nextTurnInfo.activePieceId];
            
            // 门萨鸭自动决斗
            if (nextPiece.skillId === 'mensa' && nextPiece.mensaTargetId) {
                const target = this.pieces[nextPiece.mensaTargetId];
                if (target && !target.isDead) {
                    this.systemLogs.push(`🦆 [门萨鸭] 考核期结束，强制对 [${target.charName}] 执行决斗！`);
                    const res = this.resolveCombat(nextPiece, target, true);
                    let log = `⚔️ 自动决斗：门萨鸭 vs ${target.charName}`;
                    if (res.winner === 'attacker') log += " -> 门萨鸭胜";
                    else if (res.winner === 'defender') log += " -> 门萨鸭败";
                    else log += " -> 平局";
                    if (res.specialLog) log += ` ${res.specialLog}`;
                    this.systemLogs.push(log);
                    nextPiece.mensaTargetId = null;
                    this.endTurn(); 
                    return; 
                } else {
                    nextPiece.mensaTargetId = null;
                }
            }

            // 【新增】触发回合开始事件 (只炮回血, 317检测)
            this.onTurnStart(nextPiece);
        }

        this.checkAndSkipIfStuck(this.activeTeam, 0);
    }

    checkAndSkipIfStuck(team, recursionDepth = 0) {
        if (this.winner) return;
        if (recursionDepth > 14) { console.log("僵局"); return; }

        const turnInfo = this.getCurrentTurnInfo();
        if (!turnInfo) return;
        const piece = this.pieces[turnInfo.activePieceId];

        let shouldSkip = false;
        let skipReason = "";

        if (piece.isFrozen) {
            shouldSkip = true;
            skipReason = `[${piece.charName}] 处于考核期，本回合禁足！`;
            piece.isFrozen = false; 
        } else if (!this.checkMobility(piece)) {
            shouldSkip = true;
            skipReason = `[${piece.charName}] 被队友包围，无路可走！`;
        }

        if (shouldSkip) {
            this.systemLogs.push(skipReason);
            this.currentPointers[team] = (this.currentPointers[team] + 1) % 7;
            this.activeTeam = (team === 'A' ? 'B' : 'A'); 
            // 切换到下一个人，也要触发 onTurnStart
            const nextInfo = this.getCurrentTurnInfo();
            if (nextInfo) this.onTurnStart(this.pieces[nextInfo.activePieceId]);
            
            this.checkAndSkipIfStuck(this.activeTeam, recursionDepth + 1);
        }
    }

    checkMobility(piece) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const tx = piece.x + dx; const ty = piece.y + dy;
                if (tx >= 0 && tx <= 6 && ty >= 0 && ty <= 6) {
                    const target = this.board[ty][tx];
                    if (!target || target.team !== piece.team) {
                        if (piece.skillId === 'a2' && !piece.isSilenced && target && target.team === piece.team) {
                             if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                                 const jumpX = tx + dx; 
                                 const jumpY = ty + dy;
                                 if (jumpX >= 0 && jumpX <= 6 && jumpY >= 0 && jumpY <= 6) {
                                     const jumpTarget = this.board[jumpY][jumpX];
                                     if (!jumpTarget || jumpTarget.team !== piece.team) return true;
                                 }
                             }
                        }
                        if (piece.skillId === 'zhipao' && !piece.isSilenced && target && target.team === piece.team) return true; // 只炮可以换位
                        if (piece.skillId === 'huaqi') return true; 
                        if (this.isValidPath(piece.x, piece.y, tx, ty)) return true;
                    }
                }
            }
        }
        return false;
    }

    useSkill(playerRequest) {
        const turnInfo = this.getCurrentTurnInfo();
        if (!turnInfo) return { success: false, msg: "游戏结束" };
        const piece = this.pieces[turnInfo.activePieceId];
        if (playerRequest.playerId !== piece.owner) return { success: false, msg: "不归你管" };

        if (piece.isSilenced) return { success: false, msg: "你已被【禁魔】，无法使用主动技能！" };

        // 1. 银灰
        if (piece.skillId === 'silverash') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "次数已耗尽" };
            const targetPiece = this.board[playerRequest.y][playerRequest.x];
            if (!targetPiece || targetPiece.team === piece.team) return { success: false, msg: "目标无效" };
            const dx = Math.abs(piece.x - playerRequest.x);
            const dy = Math.abs(piece.y - playerRequest.y);
            if (dx > 1 || dy > 1) return { success: false, msg: "距离太远" };
            piece.currentSkillUses++;
            if (!targetPiece.revealedTo.includes(piece.team)) targetPiece.revealedTo.push(piece.team);
            return { success: true, publicMsg: `[银灰] 发动鹰眼，看穿了 [${targetPiece.charName}]！`, privateMsg: `[${targetPiece.charName}] 是 [${targetPiece.rankTitle}]` };
        }

        // 2. 玛恩纳
        if (piece.skillId === 'mlynar') {
            if (piece.rank >= 5) return { success: false, msg: "等级已满" };
            piece.rank += 1; piece.rankTitle = RANK_NAMES[piece.rank];
            return { success: true, publicMsg: `[玛恩纳] 摸鱼看报，等级+1 (当前: ${piece.rankTitle})`, consumeTurn: true };
        }

        // 3. 阿米娅
        if (piece.skillId === 'amiya') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "技能耗尽" };
            if (piece.isChimeraActive) return { success: false, msg: "已开启" };
            piece.isChimeraActive = true; piece.currentSkillUses++; 
            return { success: true, publicMsg: `[阿米娅] 奇美拉启动！(下一次攻击必胜)` };
        }

        // 4. 门萨鸭
        if (piece.skillId === 'mensa') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "技能耗尽" };
            const targetPiece = this.board[playerRequest.y][playerRequest.x];
            if (!targetPiece || targetPiece.team === piece.team) return { success: false, msg: "只能考核敌方" };
            
            piece.currentSkillUses++;
            targetPiece.isFrozen = true; 
            targetPiece.isVulnerable = true; 
            piece.mensaTargetId = targetPiece.id;

            return { success: true, publicMsg: `[门萨鸭] 将 [${targetPiece.charName}] 纳入【考核期】，下回合将自动对其进行决斗。`, consumeTurn: true };
        }

        // 5. 莱伊
        if (piece.skillId === 'ray') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "子弹耗尽" };
            const targetPiece = this.board[playerRequest.y][playerRequest.x];
            if (!targetPiece || targetPiece.team === piece.team) return { success: false, msg: "只能攻击敌方" };
            piece.currentSkillUses++;
            const combatRes = this.resolveCombat(piece, targetPiece, true);
            let log = `[莱伊] 召唤沙地兽全图狙击 [${targetPiece.charName}]！`;
            if (combatRes.winner === 'attacker') log += ` -> 击杀成功！`;
            else if (combatRes.winner === 'defender') log += ` -> 狙击失败，遭到反杀！`;
            else log += ` -> 平局 (各-1血)`;
            if (combatRes.specialLog) log += ` ${combatRes.specialLog}`;
            return { success: true, publicMsg: log, consumeTurn: true };
        }

        // 6. 三笙
        if (piece.skillId === 'ycyx') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "技能耗尽" };
            const targetPiece = this.board[playerRequest.y][playerRequest.x];
            if (!targetPiece || targetPiece.team === piece.team) return { success: false, msg: "只能魅惑敌方" };
            const dx = Math.abs(piece.x - playerRequest.x);
            const dy = Math.abs(piece.y - playerRequest.y);
            if (dx > 1 || dy > 1) return { success: false, msg: "距离太远" };
            piece.currentSkillUses++;
            targetPiece.isSilenced = true; 
            return { success: true, publicMsg: `[三笙] 对 [${targetPiece.charName}] 发动“我喜欢你”。对方陷入混乱，被【禁魔】！`, consumeTurn: true };
        }

        // 7. 黄头 (改用 applyDamage)
        if (piece.skillId === 'yellow') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "技能耗尽" };
            piece.currentSkillUses++;
            const enemies = [];
            for(let y=0; y<=6; y++) for(let x=0; x<=6; x++) {
                const target = this.board[y][x];
                if (target && target.team !== piece.team && !target.isDead && target.tags.isStarch) enemies.push(target);
            }
            if (enemies.length === 0) return { success: true, publicMsg: `[黄头] 环顾四周，没有发现敌对淀粉组员，空大了一次。`, consumeTurn: true };
            let log = `[黄头] 发动“反头派清洗”！不死不休！`;
            let yellowDamageTaken = 0; 
            for (let target of enemies) {
                if (target.isDead) continue; 
                const res = this.calculateDuelResult(piece, target);
                const enemyDmgFactor = target.isVulnerable ? 2 : 1;
                const yellowDmgFactor = piece.isVulnerable ? 2 : 1; 
                let combatResultStr = "";
                if (res === 'A') { 
                    this.applyDamage(piece, target, enemyDmgFactor); // 使用 applyDamage
                    if (target.isVulnerable) target.isVulnerable = false;
                    combatResultStr = "清洗成功";
                } else if (res === 'B') { 
                    yellowDamageTaken += yellowDmgFactor;
                    if (piece.isVulnerable) piece.isVulnerable = false;
                    combatResultStr = "被反杀";
                } else { 
                    this.applyDamage(piece, target, 1); // 使用 applyDamage
                    yellowDamageTaken += 1;
                    combatResultStr = "平局";
                }
                log += `<br>⚔️ vs [${target.charName}]: ${combatResultStr}`;
            }
            if (yellowDamageTaken > 0) {
                this.applyDamage(null, piece, yellowDamageTaken); // 使用 applyDamage 处理反噬
                log += `<br>💔 [黄头] 承受 ${yellowDamageTaken} 点伤害`;
                if (piece.hp <= 0) log += "，力竭阵亡！"; else log += "，幸存下来！";
            }
            return { success: true, publicMsg: log, consumeTurn: true };
        }

        // 8. 龙哥哥 (Dragon) (改用 applyDamage)
        if (piece.skillId === 'dragon') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "技能次数已耗尽" };
            const tx = playerRequest.x; const ty = playerRequest.y;
            const targetPiece = this.board[ty][tx];

            if (playerRequest.allyX !== undefined && playerRequest.allyY !== undefined) {
                const allyPiece = this.board[playerRequest.allyY][playerRequest.allyX];
                if (!targetPiece || targetPiece.team === piece.team) return { success: false, msg: "目标1必须是敌人" };
                const distEnemy = Math.abs(targetPiece.x - piece.x) <= 1 && Math.abs(targetPiece.y - piece.y) <= 1;
                if (!distEnemy) return { success: false, msg: "敌人必须在周围八格内" };
                if (!allyPiece || allyPiece.team !== piece.team) return { success: false, msg: "目标2必须是队友" };
                const distAlly = Math.abs(allyPiece.x - piece.x) <= 1 && Math.abs(allyPiece.y - piece.y) <= 1;
                if (!distAlly) return { success: false, msg: "队友必须在周围八格内" };

                piece.currentSkillUses++;
                const combatRes = this.resolveCombat(allyPiece, targetPiece, true); 
                let log = `[龙哥哥] 举办鲜蔬杯，强制 [${allyPiece.charName}] 与 [${targetPiece.charName}] 决斗！`;
                if (combatRes.winner === 'attacker') log += ` -> 队友获胜！`;
                else if (combatRes.winner === 'defender') log += ` -> 队友落败！`;
                else log += ` -> 平局！`;
                return { success: true, publicMsg: log, consumeTurn: true };
            }

            let targets = [];
            let mode = "";
            if (tx === piece.x && ty !== piece.y) {
                mode = "整列";
                for(let y=0; y<=6; y++) if(this.board[y][tx] && !this.board[y][tx].isDead) targets.push(this.board[y][tx]);
            } else if (ty === piece.y && tx !== piece.x) {
                mode = "整行";
                for(let x=0; x<=6; x++) if(this.board[ty][x] && !this.board[ty][x].isDead) targets.push(this.board[ty][x]);
            } else {
                 return { success: false, msg: "破碎大道：请点击【同行】或【同列】触发地火；鲜蔬杯：请先点击周围敌人再点击周围队友。" };
            }

            piece.currentSkillUses++;
            let log = `[龙哥哥] 开启破碎大道！${mode}地火喷涌！`;
            targets.forEach(t => {
                const roll = Math.random();
                if (roll < 0.7) {
                    this.applyDamage(piece, t, 1); // 使用 applyDamage
                    log += `<br>🔥 [${t.charName}] 被烧伤 (-1)`;
                } else {
                    log += `<br>💨 [${t.charName}] 躲过了地火`;
                }
            });
            return { success: true, publicMsg: log, consumeTurn: true };
        }

        // 9. 只炮 (Zhipao)
        if (piece.skillId === 'zhipao') {
            if (piece.currentSkillUses >= piece.maxSkillUses) return { success: false, msg: "魔术只能变一次" };
            
            const targetPiece = this.board[playerRequest.y][playerRequest.x];
            if (!targetPiece || targetPiece.team !== piece.team) return { success: false, msg: "只能与队友交换" };
            if (targetPiece.id === piece.id) return { success: false, msg: "不能交换自己" };
            
            piece.currentSkillUses++;

            // 交换位置
            const tempX = piece.x; const tempY = piece.y;
            piece.x = targetPiece.x; piece.y = targetPiece.y;
            this.board[piece.y][piece.x] = piece;
            targetPiece.x = tempX; targetPiece.y = tempY;
            this.board[targetPiece.y][targetPiece.x] = targetPiece;

            return { 
                success: true, 
                publicMsg: `[只炮] 发动魔术！与 [${targetPiece.charName}] 交换了位置！`, 
                consumeTurn: true 
            };
        }

        return { success: false, msg: "无可用技能" };
    }

    move(playerRequest) {
        if (this.pendingDecision) return { success: false, msg: "正在等待对方响应..." };

        const turnInfo = this.getCurrentTurnInfo();
        if (!turnInfo) return { success: false, msg: "游戏结束" };
        const piece = this.pieces[turnInfo.activePieceId];
        if (playerRequest.playerId !== piece.owner) return { success: false, msg: "不归你管" };
        
        let preCombatSnapshot = null;
        if (piece.skillId === 'a2' && piece.currentSkillUses < piece.maxSkillUses) {
            preCombatSnapshot = this.serializeState();
        }

        let isPathValid = false;
        let isJump = false;

        if (piece.skillId === 'huaqi') {
            const dx = Math.abs(playerRequest.x - piece.x);
            const dy = Math.abs(playerRequest.y - piece.y);
            if (dx <= 1 && dy <= 1 && (dx + dy > 0)) isPathValid = true; 
        } else if (piece.skillId === 'wolf') {
            const hasCautusNearby = this.checkNearbyForTag(piece.x, piece.y, 'isCautus', piece.team);
            if (hasCautusNearby) {
                 if (this.isValidPath(piece.x, piece.y, playerRequest.x, playerRequest.y)) isPathValid = true; 
                 else { isPathValid = (Math.abs(playerRequest.x-piece.x)+Math.abs(playerRequest.y-piece.y) <= 2); }
            } else isPathValid = this.isValidPath(piece.x, piece.y, playerRequest.x, playerRequest.y);
        } else if (piece.skillId === 'a2') {
            if (!piece.isSilenced) {
                const dx = playerRequest.x - piece.x;
                const dy = playerRequest.y - piece.y;
                if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && (Math.abs(dx) === 2 || Math.abs(dy) === 2)) {
                     const midX = piece.x + dx/2;
                     const midY = piece.y + dy/2;
                     if (Number.isInteger(midX) && Number.isInteger(midY)) {
                         const midPiece = this.board[midY][midX];
                         if (midPiece && midPiece.team === piece.team) {
                             isPathValid = true;
                             isJump = true;
                         }
                     }
                }
            }
            if (!isPathValid) isPathValid = this.isValidPath(piece.x, piece.y, playerRequest.x, playerRequest.y);
        } else {
            isPathValid = this.isValidPath(piece.x, piece.y, playerRequest.x, playerRequest.y);
        }

        if (!isPathValid) return { success: false, msg: "路径不通" };

        const targetCell = this.board[playerRequest.y][playerRequest.x];
        let result = { success: true };

        if (!targetCell) {
            this.updateBoardPosition(piece, playerRequest.x, playerRequest.y);
            result.type = 'move';
            if (isJump) result.specialLog = "🚀 小飞机起飞！";
        } else if (targetCell.team === piece.team) {
            return { success: false, msg: "不能踩队友" };
        } else {
            const enemyWolves = Object.values(this.pieces).filter(p => p.team !== piece.team && !p.isDead && p.skillId === 'wolf');
            let tauntedWolf = null;
            for (let wolf of enemyWolves) {
                if (this.isValidPath(piece.x, piece.y, wolf.x, wolf.y)) { tauntedWolf = wolf; break; }
            }
            if (tauntedWolf && targetCell.id !== tauntedWolf.id) {
                return { success: false, msg: `受到 [血狼破军] 嘲讽，必须先攻击他！`, isTaunt: true, taunter: tauntedWolf.charName };
            }

            if (targetCell.skillId === 've' && !targetCell.isSilenced && targetCell.currentSkillUses < targetCell.maxSkillUses) {
                this.pendingDecision = {
                    type: 've_reject',
                    attackerId: piece.id,
                    defenderId: targetCell.id,
                    targetX: playerRequest.x,
                    targetY: playerRequest.y
                };
                return { success: true, type: 'pending_reaction', defenderOwner: targetCell.owner, msg: `触发 [VE] 的反驳型人格...` };
            }

            result.type = 'combat';
            result.result = this.resolveCombat(piece, targetCell);

            if (piece.skillId === 'a2' && !piece.isSilenced && piece.currentSkillUses < piece.maxSkillUses && result.result.winner !== 'attacker') {
                this.a2Snapshot = preCombatSnapshot;
                this.pendingDecision = {
                    type: 'a2_regret',
                    attackerId: piece.id,
                    attackerOwner: piece.owner,
                    combatResult: result.result
                };
                return { 
                    success: true, 
                    type: 'pending_a2_choice', 
                    attackerOwner: piece.owner,
                    msg: `[A2] 发动左右互搏，正在思考是否悔棋...`,
                    combatResult: result.result
                };
            }
        }

        if (result.type !== 'pending_reaction') {
            this.endTurn();
        }
        return result;
    }

    serializeState() {
        return JSON.stringify({
            pieces: this.pieces,
            boardGrid: this.board.map(row => row.map(p => p ? p.id : null)), 
            activeTeam: this.activeTeam,
            pointers: this.currentPointers,
            logs: this.systemLogs,
            dragonA2Seq: this.dragonA2Seq // 新增状态保存
        });
    }

    restoreState(jsonStr) {
        const data = JSON.parse(jsonStr);
        this.pieces = data.pieces;
        this.currentPointers = data.pointers;
        this.systemLogs = data.logs;
        this.dragonA2Seq = data.dragonA2Seq || 0; // 恢复状态
        this.board = Array(7).fill(null).map(() => Array(7).fill(null));
        for(let y=0; y<=6; y++) for(let x=0; x<=6; x++) {
            const pid = data.boardGrid[y][x];
            if (pid) this.board[y][x] = this.pieces[pid];
        }
    }

    resolveA2Regret(playerId, doRegret) {
        if (!this.pendingDecision || this.pendingDecision.type !== 'a2_regret') return { success: false };
        if (playerId !== this.pendingDecision.attackerOwner) return { success: false };

        const a2Id = this.pendingDecision.attackerId;
        this.pendingDecision = null;

        if (doRegret && this.a2Snapshot) {
            this.restoreState(this.a2Snapshot);
            this.a2Snapshot = null;
            if (this.pieces[a2Id]) this.pieces[a2Id].currentSkillUses++;
            return { success: true, publicMsg: "⏳ [A2] 发动【左右互搏】，时间倒流了！" }; 
        } else {
            this.a2Snapshot = null;
            this.endTurn();
            return { success: true, publicMsg: null };
        }
    }

    isValidPath(x1, y1, x2, y2) {
        const dx = Math.abs(x1 - x2); const dy = Math.abs(y1 - y2);
        if (dx + dy === 1) return true;
        if (dx === 1 && dy === 1) {
            const pair = [x1, y1, x2, y2].join(','); const revPair = [x2, y2, x1, y1].join(',');
            const validDiagonalSteps = ["0,0,1,1", "1,1,2,2", "2,0,1,1", "1,1,0,2", "2,2,1,3", "1,3,0,4", "2,6,1,5", "3,0,4,1", "3,3,4,4", "4,4,5,5", "5,5,6,6", "3,6,4,5", "5,5,4,4", "5,3,4,4", "4,4,5,3"];
            if (validDiagonalSteps.includes(pair) || validDiagonalSteps.includes(revPair)) return true;
        }
        return false;
    }

    calculateDuelResult(attacker, defender) {
        const rankA = attacker.rank; const rankB = defender.rank;
        if (attacker.skillId === 've') {
            const teamMembersAlive = Object.values(this.pieces).filter(p => p.team === attacker.team && !p.isDead).length;
            if (teamMembersAlive === 1) return 'A';
        }
        if (rankA === 1 && rankB === 7) return 'A';
        if (rankA === 7 && rankB === 1) return 'B';
        if (rankA === rankB) return 'D';
        return rankA > rankB ? 'A' : 'B';
    }
    
    // --- 修改：resolveCombat 使用 applyDamage ---
    resolveCombat(attacker, defender, isRemote = false) {
        let winner = null; let specialLog = ""; 
        if (attacker.skillId === 'amiya' && attacker.isChimeraActive) { winner = 'attacker'; attacker.isChimeraActive = false; specialLog += "🔥 奇美拉爆发！"; } 
        else {
            const res = this.calculateDuelResult(attacker, defender);
            if (res === 'A') { winner = 'attacker'; if (attacker.skillId === 've') { const c = Object.values(this.pieces).filter(p => p.team === attacker.team && !p.isDead).length; if (c === 1) specialLog += " 🥷 孤狼模式!"; } }
            else if (res === 'B') winner = 'defender'; else winner = 'draw';
        }
        
        const getDamage = (target) => target.isVulnerable ? 2 : 1;
        
        if (winner === 'attacker') {
            this.applyDamage(attacker, defender, getDamage(defender)); // 使用 applyDamage
            if (defender.isVulnerable) defender.isVulnerable = false;
            if (attacker.skillId === 'mensa') specialLog += " 很遗憾。";
            // 胜者移动逻辑
            if (defender.hp <= 0 && !isRemote) this.updateBoardPosition(attacker, defender.x, defender.y);
            
        } else if (winner === 'defender') {
            this.applyDamage(defender, attacker, getDamage(attacker)); // 使用 applyDamage
            if (attacker.isVulnerable) attacker.isVulnerable = false;
            
        } else {
            this.applyDamage(defender, attacker, 1);
            this.applyDamage(attacker, defender, 1);
        }
        
        this.checkWinCondition();
        return { winner, attackerName: attacker.charName, attackerRank: attacker.rankTitle, attackerTeam: attacker.team, defenderName: defender.charName, defenderRank: defender.rankTitle, defenderTeam: defender.team, attackerHp: attacker.hp, defenderHp: defender.hp, specialLog: specialLog };
    }
    
    killPiece(piece) {
        if (piece.isDead) return; piece.isDead = true;
        if (this.board[piece.y][piece.x] === piece) this.board[piece.y][piece.x] = null;
        if (piece.skillId === 'fanji') {
            if (piece.isSilenced) { this.systemLogs.push(`😶 [反季雪] 阵亡，因被【禁魔】未能触发亡语。`); return; }
            this.systemLogs.push(`💔 [反季雪] 阵亡！触发亡语：败犬的反击！`);
            for (let dy = -1; dy <= 1; dy++) { for (let dx = -1; dx <= 1; dx++) { if (dx === 0 && dy === 0) continue; const nx = piece.x + dx; const ny = piece.y + dy; if (nx >= 0 && nx <= 6 && ny >= 0 && ny <= 6) { const target = this.board[ny][nx]; if (target && target.team !== piece.team && !target.isDead) { const res = this.calculateDuelResult(piece, target); if (res === 'A') { this.systemLogs.push(`⚔️ 反季雪(${piece.rankTitle}) 战胜 [${target.charName}](${target.rankTitle})`); this.applyDamage(piece, target, 1); } else if (res === 'D') { this.systemLogs.push(`⚔️ 反季雪 与 [${target.charName}] 战平`); this.applyDamage(piece, target, 1); } else { this.systemLogs.push(`🛡️ 反季雪(${piece.rankTitle}) 不敌 [${target.charName}](${target.rankTitle})`); } } } } }
        }
    }
    updateBoardPosition(piece, newX, newY) { this.board[piece.y][piece.x] = null; piece.x = newX; piece.y = newY; this.board[newY][newX] = piece; }
    checkWinCondition() {
        const teamAAlive = Object.values(this.pieces).some(p => p.team === 'A' && !p.isDead);
        const teamBAlive = Object.values(this.pieces).some(p => p.team === 'B' && !p.isDead);
        if (!teamAAlive) this.winner = 'B'; if (!teamBAlive) this.winner = 'A';
    }
    resolveReaction(playerId, decision) {
        if (!this.pendingDecision) return { success: false };
        const { attackerId, defenderId } = this.pendingDecision;
        const attacker = this.pieces[attackerId]; const defender = this.pieces[defenderId];
        if (playerId !== defender.owner) return { success: false }; 
        this.pendingDecision = null; 
        if (decision === 'reject') { defender.currentSkillUses++; this.endTurn(); return { success: true, reacted: true, log: `🚫 [VE] 发动技能“反驳型人格”，拒绝了 [${attacker.charName}] 的决斗！` }; } 
        else { const combatRes = this.resolveCombat(attacker, defender); this.endTurn(); return { success: true, reacted: false, type: 'combat', result: combatRes }; }
    }

    getBoardForPlayer(playerId) {
        const playerTeam = this.players[playerId]; 
        const visiblePieces = [];
        Object.values(this.pieces).forEach(p => {
            if (p.isDead) return;
            visiblePieces.push({
                x: p.x, y: p.y, team: p.team,
                name: p.charName, desc: p.charDesc,        
                id: p.team === playerTeam ? p.id : undefined,
                skillId: p.skillId,
                isChimeraActive: p.isChimeraActive,
                isFrozen: p.isFrozen,
                isVulnerable: p.isVulnerable,
                isSilenced: p.isSilenced 
            });
        });

        const buildQueueData = (team) => {
            return this.actionQueues[team].map(pid => {
                const p = this.pieces[pid];
                const isMine = (team === playerTeam);
                const isRevealed = p.revealedTo.includes(playerTeam);
                return {
                    name: p.charName,
                    rankTitle: (isMine || isRevealed) ? p.rankTitle : '???', 
                    isDead: p.isDead,
                    isCurrent: (this.getCurrentTurnInfo()?.activePieceId === pid),
                    hp: p.hp, maxHp: p.maxHp
                };
            });
        };

        let currentTurn = this.getCurrentTurnInfo();
        if (currentTurn && currentTurn.team !== playerTeam) {
            const piece = this.pieces[currentTurn.activePieceId];
            const isRevealed = piece.revealedTo.includes(playerTeam);
            if (!isRevealed) currentTurn = { ...currentTurn, rankTitle: '???', };
        }

        const logsToSend = [...this.systemLogs];
        this.systemLogs = []; 

        const isA2Pending = (this.pendingDecision && this.pendingDecision.type === 'a2_regret' && this.pendingDecision.attackerOwner === playerId);
        const isVePending = (this.pendingDecision && this.pendingDecision.type === 've_reject' && this.pieces[this.pendingDecision.defenderId].owner === playerId);

        return {
            board: visiblePieces,
            status: this.status,
            turn: currentTurn, 
            winner: this.winner,
            queues: { A: buildQueueData('A'), B: buildQueueData('B') },
            myTeam: playerTeam,
            playerNames: this.playerNames,
            systemLogs: logsToSend,
            pendingDecisionType: isA2Pending ? 'a2' : (isVePending ? 've' : null)
        };
    }
}
module.exports = Game;