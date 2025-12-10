/* =========================================================
 * Echo Vocabulary Web Version - app.js (最新版)
 * 
 * 更新内容：
 * - 波形动画速度降低为原来的 1/20
 * - 朗文查词修复（支持手机/PC）
 * - 所有功能完整：账号系统 / 音频 / TTS / 间隔复习
 * =========================================================
*/

// ====================== 全局状态 ======================

// 当前登录用户（每个用户有独立 localStorage 存档）
let currentUser = null;

// 当前用户的单词列表（从 data/ordered-words.txt 载入）
let allWords = [];

// 当前用户本轮 session 用的单词（包含插入的复习卡）
let sessionWords = [];

// 当前单词索引（sessionWords 中的索引）
let currentIndex = 0;

// 当前单词对象
let currentWord = null;

// 统计：第一次答对的数量
let correctCount = 0;

// 倒计时 / 临时信息文字
let feedbackElem = null;

// 音频对象
let audioElem = null;
let remainingRepeats = 0;
let lastAudioSrc = null;

// Top 波形动画速度控制
let waveOffset = 0;


// ====================== 工具函数 ======================

// 文字提示（底部中间）
function showTempMessage(text, type="info", duration=2000) {
    const msg = document.getElementById("messageBox");
    msg.textContent = text;
    msg.className = "msg-" + type;
    msg.style.opacity = 1;

    setTimeout(() => {
        msg.style.opacity = 0;
    }, duration);
}


// 随机整数
function randInt(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
}


// 用于 localStorage：每个用户独立 key
function storageKey(name) {
    return `evocab_${currentUser}_${name}`;
}


// ====================== 载入单词 ======================

async function loadWords() {
    const response = await fetch("data/ordered-words.txt");
    const text = await response.text();

    const lines = text.split("\n").map(l => l.trim()).filter(l => l);

    allWords = lines.map((line, idx) => {
        const sharp = line.indexOf("#");
        let eng = line;
        let chi = "";
        if (sharp !== -1) {
            eng = line.substring(0, sharp).trim();
            chi = line.substring(sharp + 1).trim();
        }
        return {
            english: eng,
            lower: eng.toLowerCase(),
            chinese: chi,
            globalIndex: idx + 1
        };
    });

    console.log("Words loaded:", allWords.length);
}


// ====================== 用户系统 ======================

async function loginUser() {
    let user = prompt("请输入您的姓名（作为账号）：");
    if (!user) return;

    currentUser = user.trim();

    await loadWords();

    initSession(); // 初始化本轮

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("mainBox").style.display = "block";

    renderWave(); // 开始动画
}


// ====================== Session 初始化 ======================

function initSession() {
    let savedStart = localStorage.getItem(storageKey("progressIndex"));
    let defaultStart = savedStart ? parseInt(savedStart) : 1;

    let startIndexStr = prompt(`请输入起始序号（1 ~ ${allWords.length}），上次为 ${defaultStart}`);
    let startIndex = parseInt(startIndexStr);
    if (isNaN(startIndex) || startIndex < 1 || startIndex > allWords.length) {
        startIndex = defaultStart;
    }

    // 更新存档起点
    localStorage.setItem(storageKey("progressIndex"), startIndex);

    // 构造本轮 sessionWords
    sessionWords = allWords.slice(startIndex - 1);
    currentIndex = 0;
    correctCount = 0;

    loadWord();
}


// ====================== 显示当前单词 ======================

function loadWord() {
    if (currentIndex >= sessionWords.length) {
        finishSession();
        return;
    }

    currentWord = sessionWords[currentIndex];

    document.getElementById("statusBar").textContent =
        `本轮：${currentIndex + 1}/${sessionWords.length} | 全部：${currentWord.globalIndex}/${allWords.length}`;

    document.getElementById("answerInput").value = "";
    document.getElementById("answerInput").focus();
    document.getElementById("feedback").textContent = "";

    playPronunciation(currentWord.lower, 1);
}


// ====================== 答题逻辑 ======================

let mustCorrect = false;
let readyNext = false;

function submitAnswer() {
    const userInput = document.getElementById("answerInput").value.trim();

    if (!userInput) {
        document.getElementById("feedback").textContent = "请输入答案";
        return;
    }

    if (userInput.toLowerCase() === currentWord.lower) {
        document.getElementById("feedback").style.color = "#3fe8a0";
        document.getElementById("feedback").textContent =
            `Perfect! ${currentWord.english} — ${currentWord.chinese}`;

        if (!mustCorrect) correctCount++;

        mustCorrect = false;
        readyNext = true;
    } else {
        document.getElementById("feedback").style.color = "#ff7070";
        document.getElementById("feedback").textContent =
            `Oops！正确答案：${currentWord.english}（${currentWord.chinese}）`;

        if (!mustCorrect) {
            scheduleExtraReviews(currentWord);
        }

        mustCorrect = true;
        readyNext = false;
    }
}


// ====================== 间隔复习机制 ======================

function scheduleExtraReviews(word) {
    const OFFSETS = [4, 10, 22, 40, 64, 94, 130, 172];

    for (let off of OFFSETS) {
        let target = currentIndex + off;
        if (target > sessionWords.length) target = sessionWords.length;
        sessionWords.splice(target, 0, word);
    }
}


// ====================== 下一题 ======================

function nextWord() {
    if (!readyNext) {
        showTempMessage("请先答对当前单词再继续", "error");
        return;
    }

    currentIndex++;

    // 更新全局进度
    localStorage.setItem(storageKey("progressIndex"), currentWord.globalIndex + 1);

    loadWord();
}


// ====================== 完成本轮 ======================

function finishSession() {
    alert(
        `本轮结束！\n` +
        `总题数：${sessionWords.length}\n` +
        `第一次答对：${correctCount}\n` +
        `正确率：${(correctCount / sessionWords.length * 100).toFixed(2)}%`
    );
    location.reload();
}


// ====================== 音频播放 + TTS ======================

function playPronunciation(wordLower, times = 1) {
    stopAudio();
    if (!wordLower) return;
    remainingRepeats = Math.max(0, times - 1);

    const first = wordLower[0];
    const src = `audio/${first}/${wordLower}.mp3`;

    lastAudioSrc = src;
    startAudioWithFallback(src, wordLower);
}

function startAudioWithFallback(src, wordLower) {
    audioElem = new Audio(src);
    audioElem.onended = () => {
        if (remainingRepeats > 0 && lastAudioSrc) {
            remainingRepeats--;
            startAudioWithFallback(lastAudioSrc, wordLower);
        }
    };
    audioElem.onerror = () => {
        useTtsOrShowError(wordLower, src);
    };
    audioElem.play().catch(() => {
        useTtsOrShowError(wordLower, src);
    });
}

function stopAudio() {
    remainingRepeats = 0;
    lastAudioSrc = null;
    if (audioElem) {
        try {
            audioElem.pause();
            audioElem.currentTime = 0;
        } catch (e) {}
        audioElem = null;
    }
}

// ====================== TTS 回退 ======================

function useTtsOrShowError(wordLower, audioName) {
    const fb = document.getElementById("feedback");
    if (!("speechSynthesis" in window)) {
        if (fb) {
            fb.style.color = "#dce6ff";
            fb.textContent = audioName
                ? `音频播放失败（${audioName}），且浏览器不支持 TTS。`
                : `找不到音频文件，且浏览器不支持 TTS。`;
        }
        return;
    }

    const utter = new SpeechSynthesisUtterance(wordLower);
    utter.lang = "en-US";
    utter.rate = 0.9;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);

    if (fb) {
        fb.style.color = "#dce6ff";
        if (audioName) {
            fb.textContent = `音频播放失败（${audioName}），改用 TTS 发音：${wordLower}`;
        } else {
            fb.textContent = `找不到音频，已使用 TTS 发音：${wordLower}`;
        }
    }
}


// ====================== 外部词典 / 图片 ======================

// 打开新标签或当前页面
function openInNewTabOrSelf(url) {
    let win = null;
    try {
        win = window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
        win = null;
    }
    if (!win) {
        // 被拦截，就用当前页面跳转
        window.location.href = url;
    }
}

// ✅ 朗文 LDOCE（新版：/dictionary/{word}）
function openLdoce(word) {
    if (!word) {
        showTempMessage("当前没有单词可以查朗文词典", "info");
        return;
    }
    const lower = word.trim().toLowerCase();
    const encoded = encodeURIComponent(lower);
    const url = `https://www.ldoceonline.com/dictionary/${encoded}`;
    openInNewTabOrSelf(url);
}

// 有道词典
function openYoudao(word) {
    if (!word) {
        showTempMessage("当前没有单词可以查有道词典", "info");
        return;
    }
    const encoded = encodeURIComponent(word.trim());
    const url = `https://youdao.com/result?word=${encoded}&lang=en`;
    openInNewTabOrSelf(url);
}

// 必应图片
function openBingImages(word) {
    if (!word) {
        showTempMessage("当前没有单词可以查图片", "info");
        return;
    }
    const encoded = encodeURIComponent(word.trim());
    const url = `https://www.bing.com/images/search?q=${encoded}`;
    openInNewTabOrSelf(url);
}


// ====================== 顶部波形动画（速度 = 原来的 1/20） ======================

function startWaveAnimation() {
    const canvas = document.getElementById("waveCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    function resize() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    resize();
    window.addEventListener("resize", resize);

    let t = 0;

    function draw() {
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h) {
            requestAnimationFrame(draw);
            return;
        }

        ctx.clearRect(0, 0, w, h);

        // 底部细线
        ctx.strokeStyle = "#285a96";
        ctx.beginPath();
        ctx.moveTo(0, h - 2);
        ctx.lineTo(w, h - 2);
        ctx.stroke();

        const barWidth = 4;
        const gap = 2;
        let x = 0;
        let tt = t;

        while (x < w) {
            let v = 0.5 * (Math.sin(tt) + Math.sin(tt * 0.7) + Math.sin(tt * 1.3));
            v = Math.abs(v);
            const barHeight = v * (h - 25);
            const y = h / 2 - barHeight / 2;

            const grd = ctx.createLinearGradient(x, y, x, y + barHeight);
            grd.addColorStop(0, "rgba(120,190,255,0.9)");
            grd.addColorStop(1, "rgba(30,120,210,0.9)");
            ctx.fillStyle = grd;

            const r = 4;
            ctx.beginPath();
            ctx.moveTo(x, y + r);
            ctx.arcTo(x, y, x + barWidth, y, r);
            ctx.arcTo(x + barWidth, y, x + barWidth, y + barHeight, r);
            ctx.arcTo(x + barWidth, y + barHeight, x, y + barHeight, r);
            ctx.arcTo(x, y + barHeight, x, y, r);
            ctx.closePath();
            ctx.fill();

            x += barWidth + gap;
            // 🔽 这里把速度降低为原来的 1/20
            tt += 0.28 / 20;
        }

        t += 0.05 / 20; // 🔽 整体相位速度也降低为 1/20

        requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
}


// ====================== 事件绑定 & 启动入口 ======================

// 重新定义 loginUser（覆盖前面版本，加上空节点保护 + 启动波形）
async function loginUser() {
    let user = prompt("请输入您的姓名（作为账号）：");
    if (!user) return;
    currentUser = user.trim();

    await loadWords();
    initSession();

    // 如果页面里有 loginBox/mainBox，就控制显示；没有就忽略
    const loginBox = document.getElementById("loginBox");
    const mainBox  = document.getElementById("mainBox");
    if (loginBox && mainBox) {
        loginBox.style.display = "none";
        mainBox.style.display  = "flex";
    }

    startWaveAnimation();
}

document.addEventListener("DOMContentLoaded", () => {
    feedbackElem = document.getElementById("feedback");

    // 如果你有“登录按钮”（例如 id="loginBtn"），可以点击登录
    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            loginUser();
        });
    } else {
        // 没有登录按钮：页面加载完就立即提示输入姓名
        loginUser();
    }

    const answerInput = document.getElementById("answerInput");
    if (answerInput) {
        answerInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (readyNext) {
                    nextWord();
                } else {
                    submitAnswer();
                }
            }
        });
    }

    const playBtn = document.getElementById("playBtn");
    if (playBtn) {
        playBtn.addEventListener("click", () => {
            if (currentWord) {
                playPronunciation(currentWord.lower, 1);
            } else {
                showTempMessage("当前没有单词可播放", "info");
            }
        });
    }

    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            if (readyNext) {
                nextWord();
            } else {
                showTempMessage("请先答对当前单词再继续", "error");
            }
        });
    }

    const ldoceBtn = document.getElementById("ldoceBtn");
    if (ldoceBtn) {
        ldoceBtn.addEventListener("click", () => {
            if (!currentWord) {
                showTempMessage("当前没有单词可以查朗文", "info");
                return;
            }
            openLdoce(currentWord.english);
        });
    }

    const youdaoBtn = document.getElementById("youdaoBtn");
    if (youdaoBtn) {
        youdaoBtn.addEventListener("click", () => {
            if (!currentWord) {
                showTempMessage("当前没有单词可以查有道", "info");
                return;
            }
            openYoudao(currentWord.english);
        });
    }

    const bingImgBtn = document.getElementById("bingImgBtn");
    if (bingImgBtn) {
        bingImgBtn.addEventListener("click", () => {
            if (!currentWord) {
                showTempMessage("当前没有单词可以查图片", "info");
                return;
            }
            openBingImages(currentWord.english);
        });
    }

    const resetBtn = document.getElementById("resetBtn");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            if (!currentUser) {
                showTempMessage("当前还没有登录用户", "info");
                return;
            }
            if (!confirm(`确定要重置账号 ${currentUser} 的学习进度吗？`)) {
                return;
            }
            localStorage.removeItem(storageKey("progressIndex"));
            showTempMessage("已重置进度，将重新开始本轮", "info");
            initSession();
        });
    }
});
