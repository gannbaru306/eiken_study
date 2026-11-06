let allData = [];
let currentSet = [];
let index = 0;
let combo = 0;
let totalScore = 0;
let timerId = null;
let startTime = 0;
let history = [];
let wrongQuestions = [];
let chart = null;
let inReviewMode = false;
let inTodayReviewMode = false;
// 単語別記録: { "<level>|<word>": { level, word, meaning, correct, wrong, intervalDays, due, lastSeen } }
let words = {};

// --- v1.6: 永続化 + 間隔反復 ---
const STORAGE_KEY = 'eiken_study_v1';
const SM2_STEPS = [1, 3, 7, 14, 30]; // 正解時の間隔（日）。上限30日

// 音声
let englishVoice = null;
let japaneseVoice = null;

// DOM取得
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const maxInfo = document.getElementById('max-info');
const startBtn = document.getElementById('start-btn');
const reviewBtn = document.getElementById('review-btn');
const todayReviewBtn = document.getElementById('today-review-btn');
const dueCountBadge = document.getElementById('due-count-badge');
const importCsvBtn = document.getElementById('import-csv-btn');
const importHistoryInput = document.getElementById('import-history-input');
const clearDataBtn = document.getElementById('clear-data-btn');
const quizPanel = document.getElementById('quiz-panel');
const progressEl = document.getElementById('progress');
const timerEl = document.getElementById('timer');
const scoreInfo = document.getElementById('score-info');
const comboInfo = document.getElementById('combo-info');
const questionText = document.getElementById('question-text');
const answerText = document.getElementById('answer-text');
const showAnswerBtn = document.getElementById('show-answer-btn');
const correctBtn = document.getElementById('correct-btn');
const wrongBtn = document.getElementById('wrong-btn');
const choicesEl = document.getElementById('choices');
const judgeButtons = document.getElementById('judge-buttons');
const questionCountInput = document.getElementById('question-count');
const historyTableBody = document.querySelector('#history-table tbody');
const filterLevel = document.getElementById('filter-level');
const filterDirection = document.getElementById('filter-direction');
const filterCorrect = document.getElementById('filter-correct');
const applyFilterBtn = document.getElementById('apply-filter-btn');
const resetFilterBtn = document.getElementById('reset-filter-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const chartCanvas = document.getElementById('history-chart');

// --- v1.6: 日付・間隔反復（簡易SM-2）・永続化 ---
// 日付はローカル日付の YYYY-MM-DD で扱う（UTCにするとJSTで1日ずれるため）。
function todayStr(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

function wordKey(level, word) {
  return `${level}|${word}`;
}

// 正解: 1 -> 3 -> 7 -> 14 -> 30日（上限30）。不正解・時間切れ: 1日に戻す。
function nextIntervalDays(current, isCorrect) {
  if (!isCorrect) return 1;
  if (!current) return 1;
  const idx = SM2_STEPS.indexOf(current);
  if (idx === -1) {
    const next = SM2_STEPS.find(s => s > current);
    return next === undefined ? 30 : next;
  }
  return SM2_STEPS[Math.min(idx + 1, SM2_STEPS.length - 1)];
}

function updateWordRecord(q, isCorrect, nowStr) {
  const now = nowStr || todayStr();
  const key = wordKey(q.level, q.word);
  const rec = words[key] || {
    level: q.level,
    word: q.word,
    meaning: q.meaning,
    correct: 0,
    wrong: 0,
    intervalDays: 0,
    due: '',
    lastSeen: ''
  };
  if (isCorrect) rec.correct++;
  else rec.wrong++;
  rec.meaning = q.meaning;
  rec.intervalDays = nextIntervalDays(rec.intervalDays, isCorrect);
  rec.lastSeen = now;
  rec.due = addDays(now, rec.intervalDays);
  words[key] = rec;
  return rec;
}

// 期限が来た単語: due <= 今日。dueが古い順、次に間違えた回数が多い順。
function getDueWords(today) {
  const t = today || todayStr();
  return Object.values(words)
    .filter(w => w.due && w.due <= t)
    .sort((a, b) => a.due.localeCompare(b.due) || b.wrong - a.wrong || a.lastSeen.localeCompare(b.lastSeen));
}

function saveProgress() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, history, words }));
  } catch (e) {
    // 容量不足などで保存できない場合は黙って無視する（学習自体は続けられる）
  }
}

function loadProgress() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data.history)) history = data.history;
    if (data.words && typeof data.words === 'object') words = data.words;
    return true;
  } catch (e) {
    return false;
  }
}

function clearSavedProgress() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // 無視
  }
}

function updateDueBadge() {
  if (!dueCountBadge) return;
  const n = getDueWords().length;
  dueCountBadge.textContent = `今日の復習：${n}件`;
}

// CSVの1行をクォート対応で分割する（単語CSV・履歴CSVで共通）。
function splitCSVLine(line) {
  return line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(s => s.replace(/^"|"$/g, '')) || [];
}

// --- CSVパーサー（クォート対応） ---
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];

  const splitLine = splitCSVLine;

  const header = splitLine(lines[0]);
  const levelIdx = header.indexOf('level');
  const wordIdx = header.indexOf('word');
  const meaningIdx = header.indexOf('meaning');

  if (levelIdx === -1 || wordIdx === -1 || meaningIdx === -1) {
    alert('CSVに level, word, meaning のヘッダーが必要です。');
    return [];
  }

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (!cols.length) continue;
    data.push({
      level: cols[levelIdx],
      word: cols[wordIdx],
      meaning: cols[meaningIdx],
      reviewed: false
    });
  }
  return data;
}

// --- v1.6: 履歴CSV（エクスポート形式）のパーサー ---
// 形式: no,level,direction,question,answer,correct,time,baseScore,combo,added,reviewed
// correct/reviewed は '1'/'0'。due（次回復習日）は履歴CSVに含まれないため空欄になる。
function parseHistoryCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];

  const header = splitCSVLine(lines[0]);
  const idx = name => header.indexOf(name);
  if (idx('no') === -1 || idx('level') === -1 || idx('question') === -1 || idx('answer') === -1) {
    alert('履歴CSVの形式が違います。エクスポートした履歴CSVを使ってください。');
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (!cols.length) continue;
    rows.push({
      no: rows.length + 1,
      level: cols[idx('level')] || '',
      direction: cols[idx('direction')] || '',
      question: cols[idx('question')] || '',
      answer: cols[idx('answer')] || '',
      correct: cols[idx('correct')] === '1',
      time: cols[idx('time')] || '0',
      baseScore: Number(cols[idx('baseScore')]) || 0,
      combo: Number(cols[idx('combo')]) || 0,
      added: Number(cols[idx('added')]) || 0,
      reviewed: cols[idx('reviewed')] === '1',
      due: ''
    });
  }
  return rows;
}

// --- 音声ボイスの初期化 ---
function initVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return;

  englishVoice =
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang.startsWith('en')) ||
    null;

  japaneseVoice =
    voices.find(v => v.lang === 'ja-JP') ||
    voices.find(v => v.lang.startsWith('ja')) ||
    null;
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = initVoices;
  initVoices();
}

// --- 言語判定（日本語なら ja、英語なら en） ---
function detectLang(text) {
  return /[ぁ-んァ-ン一-龠]/.test(text) ? 'ja' : 'en';
}

function speak(text) {
  if (!window.speechSynthesis) return;

  if (!englishVoice || !japaneseVoice) {
    setTimeout(() => speak(text), 200);
    return;
  }

  const lang = detectLang(text);
  const uttr = new SpeechSynthesisUtterance(text);

  if (lang === 'en') {
    uttr.lang = 'en-US';
    uttr.voice = englishVoice;
  } else {
    uttr.lang = 'ja-JP';
    uttr.voice = japaneseVoice;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(uttr);
}

// --- イベント ---
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    allData = parseCSV(ev.target.result);
    fileInfo.textContent = `読み込み済み：${file.name}（${allData.length}件）`;
    updateMaxInfo();
  };
  reader.readAsText(file, 'UTF-8');
});

function getSelectedLevel() {
  return document.querySelector('input[name="level"]:checked').value;
}
function getDirection() {
  return document.querySelector('input[name="direction"]:checked').value;
}
function getMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function updateMaxInfo() {
  if (!allData.length) {
    maxInfo.textContent = '';
    return;
  }
  const lv = getSelectedLevel();
  const filtered = allData.filter(d => d.level === lv && !d.reviewed);
  maxInfo.textContent = `（最大：${filtered.length}問）`;
}

document.querySelectorAll('input[name="level"]').forEach(r => {
  r.addEventListener('change', updateMaxInfo);
});

// --- クイズ開始 ---
startBtn.addEventListener('click', () => {
  inReviewMode = false;
  inTodayReviewMode = false;

  if (!allData.length) {
    alert('CSVを読み込んでください。');
    return;
  }

  const lv = getSelectedLevel();
  const filtered = allData.filter(d => d.level === lv && !d.reviewed);

  if (!filtered.length) {
    alert('この級の未復習データがありません。');
    return;
  }

  let n = parseInt(questionCountInput.value, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > filtered.length) n = filtered.length;

  currentSet = filtered.slice().sort(() => Math.random() - 0.5).slice(0, n);
  index = 0;
  combo = 0;
  totalScore = 0;
  wrongQuestions = [];

  quizPanel.style.display = 'block';
  scoreInfo.textContent = 'スコア: 0';
  comboInfo.textContent = 'コンボ: 0';

  showQuestion();
});

// --- 復習モード ---
reviewBtn.addEventListener('click', () => {
  if (!wrongQuestions.length) {
    alert('復習する問題がありません。');
    return;
  }

  inReviewMode = true;
  inTodayReviewMode = false;
  currentSet = wrongQuestions.slice();
  wrongQuestions = []; // ← 重要：倍増防止

  index = 0;
  combo = 0;
  totalScore = 0;

  quizPanel.style.display = 'block';
  scoreInfo.textContent = 'スコア: 0';
  comboInfo.textContent = 'コンボ: 0';

  showQuestion();
});

// --- v1.6: 今日の復習モード ---
// 期限（due）が来た単語を、dueが古い順・間違えた回数が多い順に出題する。
// 級は問わない（全級の期限切れ単語が対象）。CSV未読込でも、保存済みの
// 単語記録から出題できる。期限切れがなければ、セッション内の間違えた
// 問題（wrongQuestions）にフォールバックする。
todayReviewBtn.addEventListener('click', () => {
  const due = getDueWords();

  if (due.length) {
    let n = parseInt(questionCountInput.value, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > due.length) n = due.length;

    currentSet = due.slice(0, n).map(w => {
      const fromData = allData.find(d => d.level === w.level && d.word === w.word);
      return fromData
        ? { ...fromData, reviewed: false }
        : { level: w.level, word: w.word, meaning: w.meaning, reviewed: false };
    });
    inReviewMode = false;
    inTodayReviewMode = true;
  } else if (wrongQuestions.length) {
    inReviewMode = true;
    inTodayReviewMode = false;
    currentSet = wrongQuestions.slice();
    wrongQuestions = []; // ← 倍増防止
  } else {
    alert('今日の復習はありません。');
    return;
  }

  index = 0;
  combo = 0;
  totalScore = 0;

  quizPanel.style.display = 'block';
  scoreInfo.textContent = 'スコア: 0';
  comboInfo.textContent = 'コンボ: 0';

  showQuestion();
});

// --- タイマー ---
function startTimer() {
  clearInterval(timerId);
  startTime = performance.now();
  timerEl.textContent = '残り: 20.0s';

  timerId = setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    const remain = 20 - elapsed;

    if (remain <= 0) {
      timerEl.textContent = '残り: 0.0s';
      clearInterval(timerId);
      handleAnswer(false, true);
    } else {
      timerEl.textContent = `残り: ${remain.toFixed(1)}s`;
    }
  }, 100);
}
// --- 自己採点モード用ボタン ---
showAnswerBtn.addEventListener('click', () => {
  answerText.style.display = 'block';
  showAnswerBtn.style.display = 'none';
  judgeButtons.style.display = 'flex';
  speak(answerText.textContent);
});

correctBtn.addEventListener('click', () => {
  handleAnswer(true, false);
});

wrongBtn.addEventListener('click', () => {
  handleAnswer(false, false);
});

function calcBaseScore(elapsedSec) {
  const t = Math.max(0, Math.min(20, elapsedSec));
  return Math.round(1000 * (1 - t / 20));
}

// --- 出題 ---
function showQuestion() {
  const q = currentSet[index];
  const direction = getDirection();
  const mode = getMode();

  let actualDir = direction;
  if (direction === 'random') {
    actualDir = Math.random() < 0.5 ? 'en2ja' : 'ja2en';
  }
  q.actualDir = actualDir;

  let question, answer;
  if (actualDir === 'en2ja') {
    question = q.word;
    answer = q.meaning;
  } else {
    question = q.meaning;
    answer = q.word;
  }

  questionText.textContent = question;
  answerText.textContent = answer;
  answerText.style.display = 'none';

  progressEl.textContent = `問題 ${index + 1} / ${currentSet.length}`;
  comboInfo.textContent = `コンボ: ${combo}`;
  choicesEl.innerHTML = '';

  if (mode === 'self') {
    showAnswerBtn.style.display = 'inline-block';
    judgeButtons.style.display = 'flex';
  } else {
    showAnswerBtn.style.display = 'none';
    judgeButtons.style.display = 'none';
    setupChoices(q, actualDir);
  }

  speak(question);
  startTimer();
}

// --- 選択肢 ---
function setupChoices(q, actualDir) {
  const correct = actualDir === 'en2ja' ? q.meaning : q.word;
  const pool = allData.filter(d => d.level === q.level && d !== q);
  const options = [correct];

  while (options.length < 4 && pool.length) {
    const r = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const opt = actualDir === 'en2ja' ? r.meaning : r.word;
    if (!options.includes(opt)) options.push(opt);
  }
  while (options.length < 4) options.push(correct);

  options.sort(() => Math.random() - 0.5);

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.textContent = opt;
    btn.addEventListener('click', () => {
      handleAnswer(opt === correct, false);
    });
    choicesEl.appendChild(btn);
  });
}

// --- 回答処理 ---
function handleAnswer(isCorrect, timeout) {
  clearInterval(timerId);

  const elapsed = (performance.now() - startTime) / 1000;
  const baseScore = isCorrect ? calcBaseScore(elapsed) : 0;

  const q = currentSet[index];
  const actualDir = q.actualDir;

  const comboBefore = combo;
  if (isCorrect && !timeout) {
    combo++;
  } else {
    combo = 0;
  }

  const added = isCorrect ? baseScore * combo : 0;
  totalScore += added;

  scoreInfo.textContent = `スコア: ${totalScore}`;
  comboInfo.textContent = `コンボ: ${combo}`;

  // 間違えた問題 → 復習対象
  if (!isCorrect || timeout) {
    if (!inReviewMode) {
      wrongQuestions.push(q);
      reviewBtn.disabled = false;
    }
  }


if (inReviewMode && isCorrect && !timeout) {
    q.reviewed = true;
}

  // v1.6: 単語別記録を更新（簡易SM-2）。正解なら間隔を伸ばし、不正解・時間切れなら1日に戻す。
  const record = updateWordRecord(q, isCorrect && !timeout);

  // 履歴追加
  history.push({
    no: history.length + 1,
    level: q.level,
    direction: actualDir,
    question: questionText.textContent,
    answer: answerText.textContent,
    correct: isCorrect && !timeout,
    time: Math.min(20, elapsed).toFixed(2),
    baseScore,
    combo: comboBefore,
    added,
    reviewed: q.reviewed,
    due: record ? record.due : ''
  });

  // v1.6: 回答のたびに保存する
  saveProgress();
  updateDueBadge();

  renderHistory();
  updateChart();

  index++;
  if (index >= currentSet.length) {
    // v1.6: 復習モード完了時にも保存する（念のため）
    saveProgress();
    updateDueBadge();
    alert(`終了！ スコア: ${totalScore}`);
    quizPanel.style.display = 'none';
  } else {
    showQuestion();
  }
}

// --- 履歴表示 ---
function getFilteredHistory() {
  return history.filter(r => {
    if (filterLevel.value !== 'all' && r.level !== filterLevel.value) return false;
    if (filterDirection.value !== 'all' && r.direction !== filterDirection.value) return false;
    if (filterCorrect.value === 'true' && !r.correct) return false;
    if (filterCorrect.value === 'false' && r.correct) return false;
    return true;
  });
}

function renderHistory() {
  const filtered = getFilteredHistory();
  historyTableBody.innerHTML = '';

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.no}</td>
      <td>${r.level}</td>
      <td>${r.direction}</td>
      <td>${r.question}</td>
      <td>${r.answer}</td>
      <td>${r.correct ? '○' : '×'}</td>
      <td>${r.time}</td>
      <td>${r.baseScore}</td>
      <td>${r.combo}</td>
      <td>${r.added}</td>
      <td>${r.reviewed ? '△' : ''}</td>
      <td>${r.due || ''}</td>
    `;
    historyTableBody.appendChild(tr);
  });
}

// --- フィルタ ---
applyFilterBtn.addEventListener('click', () => {
  renderHistory();
  updateChart();
});

resetFilterBtn.addEventListener('click', () => {
  filterLevel.value = 'all';
  filterDirection.value = 'all';
  filterCorrect.value = 'all';
  renderHistory();
  updateChart();
});

// --- CSVエクスポート ---
exportCsvBtn.addEventListener('click', () => {
  if (!history.length) {
    alert('履歴がありません。');
    return;
  }

  const rows = [
    ['no', 'level', 'direction', 'question', 'answer', 'correct', 'time', 'baseScore', 'combo', 'added', 'reviewed']
  ];

  history.forEach(r => {
    rows.push([
      r.no,
      r.level,
      r.direction,
      `"${r.question.replace(/"/g, '""')}"`,
      `"${r.answer.replace(/"/g, '""')}"`,
      r.correct ? '1' : '0',
      r.time,
      r.baseScore,
      r.combo,
      r.added,
      r.reviewed ? '1' : '0'
    ]);
  });

  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'history.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
});

// --- v1.6: 履歴CSVインポート（復元） ---
// エクスポートした履歴CSVを読み込み、現在の履歴を置き換える。
// 単語別記録（words）は履歴CSVに含まれないため、復元されない。
importCsvBtn.addEventListener('click', () => {
  importHistoryInput.click();
});

importHistoryInput.addEventListener('change', e => {
  const file = e.target.files[0];
  importHistoryInput.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const rows = parseHistoryCSV(ev.target.result);
    if (!rows.length) return;
    history = rows;
    saveProgress();
    renderHistory();
    updateChart();
    updateDueBadge();
    alert(`履歴を復元しました（${rows.length}件）`);
  };
  reader.readAsText(file, 'UTF-8');
});

// --- v1.6: 保存データを消去 ---
// localStorage の eiken_study_v1 と、メモリ上の履歴・単語別記録をすべて消す。
clearDataBtn.addEventListener('click', () => {
  if (!confirm('保存データ（履歴と単語別記録）をすべて消去しますか？')) return;
  history = [];
  words = {};
  wrongQuestions = [];
  clearSavedProgress();
  renderHistory();
  updateChart();
  updateDueBadge();
  alert('保存データを消去しました');
});

// --- グラフ ---
function updateChart() {
  // v1.6: Chart.jsのCDNが読めないときはグラフを描かずに抜ける（初回読込で止まらないように）。
  if (typeof Chart === 'undefined') return;
  const filtered = getFilteredHistory();
  const correctCount = filtered.filter(r => r.correct).length;
  const wrongCount = filtered.length - correctCount;

  const data = {
    labels: ['正解', '不正解'],
    datasets: [{
      label: '件数',
      data: [correctCount, wrongCount],
      backgroundColor: ['#4caf50', '#f44336']
    }]
  };

  if (chart) {
    chart.data = data;
    chart.update();
  } else {
    chart = new Chart(chartCanvas, {
      type: 'bar',
      data,
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, precision: 0 } }
      }
    });
  }
}

// --- 履歴リセット ---
// v1.6: 履歴だけでなく、保存済みの単語別記録も含めて保存データを消す。
document.getElementById("clear-history-btn").addEventListener("click", () => {
  history = [];
  words = {};
  wrongQuestions = [];
  clearSavedProgress();
  renderHistory();
  updateChart();
  updateDueBadge();
  alert("履歴をリセットしました");
});

// --- v1.6: 保存済みデータを読み込んで初期描画 ---
loadProgress();

// 初期描画
renderHistory();
updateChart();
updateDueBadge();

// Nodeでのテスト用（ブラウザでは module は未定義のため無害）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    nextIntervalDays,
    addDays,
    todayStr,
    updateWordRecord,
    getDueWords,
    parseHistoryCSV,
    saveProgress,
    loadProgress,
    STORAGE_KEY,
    SM2_STEPS,
    _getWords: () => words,
    _setWords: (w) => { words = w; },
    _getHistory: () => history,
    _setHistory: (h) => { history = h; }
  };
}
