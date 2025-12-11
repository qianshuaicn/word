// app.js - Echo Vocabulary Web 版核心逻辑（支持账号、多用户进度）


// ================== 0. 自定义弹窗 DOM & 通用函数 ==================

// 注意：index.html 中的弹窗 DOM 必须写在 <script src="app.js"></script> 之前
const popupBackdrop = document.getElementById('popupBackdrop');
const popupCard = popupBackdrop ? popupBackdrop.querySelector('.popup-card') : null;
const popupTitle = document.getElementById('popupTitle');
const popupMessage = document.getElementById('popupMessage');
const popupInput = document.getElementById('popupInput');
const popupOkBtn = document.getElementById('popupOkBtn');
const popupCancelBtn = document.getElementById('popupCancelBtn');

let dialogResolve = null;
let popupMode = 'input'; // 'input' | 'confirm' | 'message'

function closePopup() {
    if (popupBackdrop) {
        popupBackdrop.classList.remove('show');
    }
    dialogResolve = null;
    popupMode = 'input';
}

function openPopup(options = {}) {
    if (!popupBackdrop || !popupTitle || !popupMessage || !popupOkBtn || !popupCancelBtn) {
        console.error('弹窗 DOM 未找到，请检查 index.html 中的 popup 结构。');
        // 兜底：如果没有弹窗 DOM，就退回 alert，避免程序死掉
        window.alert(options.message || '');
        return Promise.resolve({ confirmed: true, value: null });
    }

    const {
        title = '提示',
        message = '',
        placeholder = '',
        defaultValue = '',
        okText = '确定',
        cancelText = '取消',
        mode = 'input'
    } = options;

    popupMode = mode;
    popupTitle.textContent = title;
    popupMessage.textContent = message;

    if (mode === 'input') {
        popupInput.style.display = 'block';
        popupInput.disabled = false;
        popupInput.placeholder = placeholder || '';
        popupInput.value = defaultValue || '';
        popupCancelBtn.style.display = 'inline-block';
        popupOkBtn.textContent = okText;
        popupCancelBtn.textContent = cancelText;
    } else {
        // confirm / message：隐藏输入框
        popupInput.style.display = 'none';
        popupInput.disabled = true;
        popupInput.value = '';
        popupInput.placeholder = '';
        popupOkBtn.textContent = okText;

        if (mode === 'confirm') {
            popupCancelBtn.style.display = 'inline-block';
            popupCancelBtn.textContent = cancelText;
        } else {
            // message：只保留“确定”按钮
            popupCancelBtn.style.display = 'none';
        }
    }

    popupBackdrop.classList.add('show');

    setTimeout(() => {
        if (mode === 'input') {
            popupInput.focus();
        } else {
            popupOkBtn.focus();
        }
    }, 20);

    return new Promise((resolve) => {
        dialogResolve = resolve;
    });
}

function showInputDialog(options = {}) {
    return openPopup({ ...options, mode: 'input' });
}

function showConfirmDialog(options = {}) {
    return openPopup({ ...options, mode: 'confirm' });
}

function showMessageDialog(options = {}) {
    return openPopup({ ...options, mode: 'message' });
}

// OK 按钮
if (popupOkBtn) {
    popupOkBtn.addEventListener('click', () => {
        if (dialogResolve) {
            if (popupMode === 'input') {
                dialogResolve({
                    confirmed: true,
                    value: (popupInput.value || '').trim()
                });
            } else {
                dialogResolve({
                    confirmed: true,
                    value: null
                });
            }
        }
        closePopup();
    });
}

// 取消按钮（仅 input / confirm 有用）
if (popupCancelBtn) {
    popupCancelBtn.addEventListener('click', () => {
        if (dialogResolve) {
            dialogResolve({
                confirmed: false,
                value: null
            });
        }
        closePopup();
    });
}

// 点击背景 = 取消
if (popupBackdrop) {
    popupBackdrop.addEventListener('click', (e) => {
        if (e.target === popupBackdrop) {
            if (dialogResolve) {
                dialogResolve({
                    confirmed: false,
                    value: null
                });
            }
            closePopup();
        }
    });
}

// 输入框键盘事件：Enter = 确定, Esc = 取消
if (popupInput) {
    popupInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            popupOkBtn && popupOkBtn.click();
        } else if (e.key === 'Escape') {
            popupCancelBtn && popupCancelBtn.click();
        }
    });
}


// ================== 1. 数据结构 & 全局变量 ==================

class Word {
    constructor(english, chinese) {
        this.english = english.trim();
        this.lower = this.english.toLowerCase();
        this.chinese = (chinese || "").trim();
    }
}

// 单词相关
let allWords = [];          // ordered-words.txt 中的全部单词（按原始顺序）
let words = [];             // 本轮练习列表（从起始序号开始 + 插入错题）
let wordIndexMap = new Map();   // lower → 全局序号 (1-based)
let totalWordCount = 0;

// 进度相关
let currentIndex = 0;       // 本轮当前题目索引（0-based）
let correctCount = 0;       // 本轮第一次就答对的数量
let mustCorrectCurrent = false; // 当前单词是否已经答错，需要强制更正
let readyToGoNext = false;      // 当前单词已经答对，下一次回车可以跳到下一题

// === 当前用户 ID（账号） ===
let currentUserId = null;       // 每个用户一个 ID，用于区分各自进度
let lastProgressIndex = 1;      // 当前账号的“下次起始序号”（1..N），保存在 localStorage

// 音频相关
let audioElem = null;
let remainingRepeats = 0;
let lastAudioSrc = null;

// DOM 元素（先声明，稍后在 initDomRefs 中赋值）
let statusLabel;
let answerInput;
let feedbackElem;

let brandBtn;
let playBtn;
let ldoceBtn;
let youdaoBtn;
let bingImgBtn;
let resetBtn;


// ================== 2. 播放接口 + TTS ==================

// 播放接口：wordLower 是小写单词，times 为播放次数
function playPronunciation(wordLower, times = 1) {
    stopAudio();
    if (!wordLower) return;

    remainingRepeats = Math.max(0, times - 1);

    const first = wordLower[0];
    const src = `audio/${first}/${wordLower}.mp3`;  // 约定：audio/a/apple.mp3 这种结构

    lastAudioSrc = src;
    startAudioWithFallback(src, wordLower);
}

// 从指定音频开始播放，如果失败则回退到 TTS
function startAudioWithFallback(src, wordLower) {
    audioElem = new Audio(src);

    audioElem.onended = () => {
        if (remainingRepeats > 0 && lastAudioSrc) {
            remainingRepeats--;
            startAudioWithFallback(lastAudioSrc, wordLower);
        }
    };

    audioElem.onerror = () => {
        // 加载失败 → 用 TTS
        useTtsOrShowError(wordLower, src);
    };

    audioElem.play().catch(() => {
        // 播放被浏览器阻止（需要用户交互）→ 用 TTS
        useTtsOrShowError(wordLower, src);
    });
}

// 停止当前音频
function stopAudio() {
    remainingRepeats = 0;
    lastAudioSrc = null;
    if (audioElem) {
        try {
            audioElem.pause();
            audioElem.currentTime = 0;
        } catch (e) {
            // ignore
        }
        audioElem = null;
    }
}

// TTS：使用浏览器 Web Speech API
function useTtsOrShowError(wordLower, audioName) {
    if (!feedbackElem) {
        // 非常早期调用时 DOM 还没就绪，这种情况几乎不会发生
        return;
    }

    if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(wordLower);
        utter.rate = 0.9;
        utter.pitch = 1.0;
        utter.lang = 'en-US';
        window.speechSynthesis.speak(utter);

        feedbackElem.style.color = '#dce6ff';
        if (audioName) {
            feedbackElem.textContent = `音频播放失败（${audioName}），改用 TTS 发音：${wordLower}`;
        } else {
            feedbackElem.textContent = `找不到音频，已使用 TTS 发音：${wordLower}`;
        }
    } else {
        feedbackElem.style.color = '#dce6ff';
        if (audioName) {
            feedbackElem.textContent = `音频播放失败（${audioName}），且浏览器不支持TTS。`;
        } else {
            feedbackElem.textContent = `找不到音频，且浏览器不支持TTS。`;
        }
    }
}


// ================== 3. 初始化：账号、DOM 引用、加载单词、启动 ==================

// 获取当前账号专用的 localStorage key
function getProgressKey() {
    // 确保 currentUserId 不为 null
    const id = (currentUserId || 'guest').trim() || 'guest';
    return 'echo_vocab_last_progress_' + id;
}

// 询问用户账号（例如姓名拼音、学号等） —— 使用自定义弹窗
async function askUserId() {
    const result = await showInputDialog({
        title: '欢迎使用余音单词 Echo Vocabulary',
        message:
            '请输入你的账号（例如姓名拼音或学号）。\n' +
            '同一账号可以多次登录，系统会为你单独保存进度。',
        placeholder: '例如：zhangsan 或 20250101',
        defaultValue: ''
    });

    let id;
    if (!result.confirmed) {
        id = 'guest';
    } else {
        id = (result.value || '').trim();
        if (!id) id = 'guest';
    }
    return id;
}

window.addEventListener('load', async () => {
    try {
        // 1. 先确定当前账号
        currentUserId = await askUserId();

        // 2. 初始化 DOM 引用
        initDomRefs();

        // 3. 加载单词
        await loadWords();

        // 4. 读取该账号的上次进度
        loadLastProgress();

        // 5. 询问本轮起始序号
        const startIndex = await askUserStartIndex();
        buildSessionWordsFromStart(startIndex);
        lastProgressIndex = startIndex;
        saveLastProgress();

        if (words.length === 0) {
            await showMessageDialog({
                title: '提示',
                message: `从第 ${startIndex} 个单词开始，后面已经没有单词可练习了。`
            });
            return;
        }

        // 6. 绑定事件、显示第一题、启动波形动画
        initEvents();
        updateWordInfo();
        startWaveAnimation();
    } catch (e) {
        console.error(e);
        await showMessageDialog({
            title: '错误',
            message: '初始化程序时发生错误：' + (e && e.message ? e.message : e)
        });
    }
});

// 查找 DOM 元素并赋值
function initDomRefs() {
    statusLabel  = document.getElementById('status');
    answerInput  = document.getElementById('answer');
    feedbackElem = document.getElementById('feedback');

    brandBtn   = document.getElementById('brandBtn');
    playBtn    = document.getElementById('playBtn');
    ldoceBtn   = document.getElementById('ldoceBtn');
    youdaoBtn  = document.getElementById('youdaoBtn');
    bingImgBtn = document.getElementById('bingImgBtn');
    resetBtn   = document.getElementById('resetBtn');
}

// 读取 ordered-words.txt，构建 allWords、wordIndexMap、totalWordCount
async function loadWords() {
    const resp = await fetch('data/ordered-words.txt');
    if (!resp.ok) {
        throw new Error('无法读取 data/ordered-words.txt，请检查路径和文件。');
    }
    const text = await resp.text();
    const lines = text.split(/\r?\n/);

    allWords = [];
    wordIndexMap.clear();
    let lineNo = 0;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        let eng = line;
        let chi = '';
        const idx = line.indexOf('#');
        if (idx !== -1) {
            eng = line.substring(0, idx).trim();
            chi = line.substring(idx + 1).trim();
        }

        if (eng) {
            lineNo++;
            const w = new Word(eng, chi);
            allWords.push(w);
            if (!wordIndexMap.has(w.lower)) {
                wordIndexMap.set(w.lower, lineNo);
            }
        }
    }

    totalWordCount = lineNo;
    if (totalWordCount === 0) {
        throw new Error('ordered-words.txt 为空或未读取到任何单词。');
    }

    // 默认先让 words = 全部单词，后面根据起始序号裁剪
    words = [...allWords];
}

// 从 localStorage 读取 当前账号 的 lastProgressIndex
function loadLastProgress() {
    const key = getProgressKey();
    const val = window.localStorage.getItem(key);
    if (!val) {
        lastProgressIndex = 1;
        return;
    }
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1 || n > totalWordCount) {
        lastProgressIndex = 1;
    } else {
        lastProgressIndex = n;
    }
}

// 保存 当前账号 的 lastProgressIndex 到 localStorage
function saveLastProgress() {
    let val = lastProgressIndex;
    if (val < 1) val = 1;
    if (val > totalWordCount + 1) val = totalWordCount + 1;
    const key = getProgressKey();
    window.localStorage.setItem(key, String(val));
}

// 询问用户本轮起始序号（用自定义弹窗）
async function askUserStartIndex() {
    const max = totalWordCount;
    let def = lastProgressIndex;
    if (def < 1 || def > max) def = 1;

    const msg = [
        `当前账号：${currentUserId}`,
        '',
        `请输入起始单词序号（1 ~ ${max}）开始本轮听写记单词：`,
        `序号越小，单词越常用；序号越大，单词越生僻。`,
        `上次学习进度：第 ${def} 个单词。若不修改，直接点击「确定」即可接着上次进度继续。`,
        '',
        '软件名称：余音单词 Echo Vocabulary',
        '软件特点：语音先入，真人发音，听写训练，智能复习，自动记录进度。'
    ].join('\n');

    const result = await showInputDialog({
        title: '选择起始单词序号',
        message: msg,
        placeholder: `请输入 1 ~ ${max} 的整数`,
        defaultValue: String(def)
    });

    if (!result.confirmed) {
        // 用户点了取消，就用默认
        return def;
    }

    let input = (result.value || '').trim();
    if (!input) return def;

    const n = parseInt(input, 10);
    if (isNaN(n) || n < 1 || n > max) return def;
    return n;
}

// 从 startIndex（1-based）开始，构造本轮练习列表
function buildSessionWordsFromStart(startIndex) {
    words = allWords.slice(startIndex - 1);   // 从 startIndex-1 到末尾
    currentIndex = 0;
    correctCount = 0;
    mustCorrectCurrent = false;
    readyToGoNext = false;
}


// ================== 4. 事件绑定 ==================

function initEvents() {
    // 回车键：未答对时提交答案；已答对时进入下一题
    answerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (readyToGoNext) {
                goToNextWord();
            } else {
                submitAnswer();
            }
            e.preventDefault();
        }
    });

    // 播放当前单词
    playBtn.addEventListener('click', () => {
        const w = words[currentIndex];
        if (w) {
            playPronunciation(w.lower, 1);
        }
    });

    // 官网
    brandBtn.addEventListener('click', () => {
        openInNewTab('https://www.math1234567.com/category/English');
    });

    // Collins / 有道 / 必应图片
    ldoceBtn.addEventListener('click', () => openDict('ldoce'));
    youdaoBtn.addEventListener('click', () => openDict('youdao'));
    bingImgBtn.addEventListener('click', () => openDict('bing-img'));

    // 重置进度（只重置当前账号）
    resetBtn.addEventListener('click', () => {
        // doReset 是 async，这里可以不 await
        doReset();
    });
}


// ================== 5. 练习逻辑：展示、判题、间隔复习 ==================

// 获取全局序号（1-based），没有则返回 -1
function getGlobalIndex(word) {
    if (!word) return -1;
    return wordIndexMap.get(word.lower) ?? -1;
}

// 更新顶部状态栏、清空输入框，并自动播放当前单词
function updateWordInfo() {
    if (currentIndex < 0 || currentIndex >= words.length) return;

    mustCorrectCurrent = false;
    readyToGoNext = false;

    const w = words[currentIndex];
    const localIndex = currentIndex + 1;
    const sessionTotal = words.length;
    const globalIndex = getGlobalIndex(w);

    if (globalIndex > 0) {
        statusLabel.textContent =
            `账号：${currentUserId}    本轮：${localIndex} / ${sessionTotal}    全部：${globalIndex} / ${totalWordCount}`;
    } else {
        statusLabel.textContent =
            `账号：${currentUserId}    本轮：${localIndex} / ${sessionTotal}    全部：? / ${totalWordCount}`;
    }

    feedbackElem.textContent = '\u00A0'; // 不让它完全空
    feedbackElem.style.color = '#dce6ff';

    answerInput.value = '';
    answerInput.focus();

    playPronunciation(w.lower, 1);
}

// 提交答案
function submitAnswer() {
    if (currentIndex < 0 || currentIndex >= words.length) return;

    const userInput = answerInput.value.trim();
    if (!userInput) {
        feedbackElem.textContent = '请输入你的答案。';
        feedbackElem.style.color = '#dce6ff';
        return;
    }

    const current = words[currentIndex];
    if (userInput.toLowerCase() === current.english.toLowerCase()) {
        // 回答正确
        feedbackElem.style.color = '#78e6aa';
        feedbackElem.textContent = `Perfect！ ${current.english} —— ${current.chinese}`;

        if (!mustCorrectCurrent) {
            // 只统计第一次就答对的题目
            correctCount++;
        }

        mustCorrectCurrent = false;
        readyToGoNext = true;  // 下一次回车进入下一题
    } else {
        // 回答错误
        feedbackElem.style.color = '#ff788c';
        if (!mustCorrectCurrent) {
            feedbackElem.textContent = `Sorry，是：${current.english}（${current.chinese}），请更正。`;
            mustCorrectCurrent = true;
            scheduleExtraReviews(current);
        } else {
            feedbackElem.textContent = `Sorry again，是：${current.english}（${current.chinese}），请更正。`;
        }
        readyToGoNext = false;
    }
}

// 为答错的单词安排间隔复习
// 规则：在随后 4、10、22、40、64、94、130、172 个单词之后各再出现一次
function scheduleExtraReviews(word) {
    const OFFSETS = [4, 10, 22, 40, 64, 94, 130, 172];
    const baseIndex = currentIndex;

    for (const offset of OFFSETS) {
        let targetIndex = baseIndex + offset;
        if (targetIndex > words.length) {
            targetIndex = words.length;
        }
        words.splice(targetIndex, 0, word);
    }
}

// 进入下一题；如果本轮结束，则显示总结（用自定义弹窗）
function goToNextWord() {
    // 更新 当前账号 的 lastProgressIndex：以当前单词的全局序号为基础
    if (currentIndex >= 0 && currentIndex < words.length) {
        const current = words[currentIndex];
        const gi = getGlobalIndex(current);
        if (gi > 0) {
            lastProgressIndex = Math.max(lastProgressIndex, gi + 1);
            saveLastProgress();
        }
    }

    currentIndex++;
    if (currentIndex >= words.length) {
        stopAudio();

        const total = words.length;
        const rate = total ? (correctCount * 100 / total) : 0;
        showMessageDialog({
            title: '本轮听写结束',
            message:
                `账号：${currentUserId}\n\n` +
                `本轮总题数：${total}\n` +
                `第一次就答对的题数：${correctCount}\n` +
                `正确率：${rate.toFixed(2)}%`
        });
        return;
    }

    updateWordInfo();
}


// ================== 6. 工具函数：打开网页 / 重置 ==================

function openInNewTab(url) {
    window.open(url, '_blank', 'noopener');
}

function openDict(type) {
    if (currentIndex < 0 || currentIndex >= words.length) {
        showMessageDialog({
            title: '提示',
            message: '当前没有正在练习的单词。'
        });
        return;
    }
    const w = words[currentIndex];
    const word = w.english.trim();
    if (!word) {
        showMessageDialog({
            title: '提示',
            message: '无法获取当前单词。'
        });
        return;
    }

    const encoded = encodeURIComponent(word);
    let url = '';

    if (type === 'ldoce') {
        // ✅ 已替换为 Collins 词典
        url = `https://www.collinsdictionary.com/zh/dictionary/english/${encoded}`;
    } else if (type === 'youdao') {
        url = `https://youdao.com/result?word=${encoded}&lang=en`;
    } else if (type === 'bing-img') {
        url = `https://www.bing.com/images/search?q=${encoded}`;
    }

    if (url) {
        openInNewTab(url);
    }
}

// 清空 当前账号 的进度并从第 1 个单词重新开始
async function doReset() {
    const result = await showConfirmDialog({
        title: '重置进度确认',
        message:
            `当前账号：${currentUserId}\n\n` +
            '此操作会清除该账号的所有学习进度，\n' +
            '包括下次起始序号的记录。\n\n' +
            '确定要重置到第一次使用的状态吗？',
        okText: '确定重置',
        cancelText: '取消'
    });

    if (!result.confirmed) {
        return;
    }

    const key = getProgressKey();
    window.localStorage.removeItem(key);

    // 从第 1 个单词开始新的一轮
    buildSessionWordsFromStart(1);
    lastProgressIndex = 1;
    saveLastProgress();
    updateWordInfo();

    showMessageDialog({
        title: '重置完成',
        message: `账号 ${currentUserId} 的进度已重置，已从第 1 个单词重新开始。`
    });
}


// ================== 7. 顶部“波形条”动画（速度为原来的 1/20） ==================

function startWaveAnimation() {
    const canvas = document.getElementById('waveCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    function resize() {
        // 根据 CSS 大小调整实际像素大小，避免模糊
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    resize();
    window.addEventListener('resize', resize);

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
        ctx.strokeStyle = '#285a96';
        ctx.beginPath();
        ctx.moveTo(0, h - 2);
        ctx.lineTo(w, h - 2);
        ctx.stroke();

        // 多个竖条模拟波形
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
            grd.addColorStop(0, 'rgba(120,190,255,0.9)');
            grd.addColorStop(1, 'rgba(30,120,210,0.9)');
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
            // ★ 速度调成原来的 1/20
            tt += 0.28 / 20;
        }

        // ★ 整体动画速度也调慢到 1/20
        t += 0.05 / 20;
        requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
}
