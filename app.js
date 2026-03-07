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

// 音声
let englishVoice = null;
let japaneseVoice = null;

// DOM取得
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const maxInfo = document.getElementById('max-info');
const startBtn = document.getElementById('start-btn');
const reviewBtn = document.getElementById('review-btn');
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

// --- CSVパーサー（クォート対応） ---
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];

  const splitLine = (line) =>
    line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(s => s.replace(/^"|"$/g, '')) || [];

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
    reviewed: q.reviewed
  });

  renderHistory();
  updateChart();

  index++;
  if (index >= currentSet.length) {
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

// --- グラフ ---
function updateChart() {
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
document.getElementById("clear-history-btn").addEventListener("click", () => {
  history = [];
  wrongQuestions = [];
  renderHistory();
  updateChart();
  alert("履歴をリセットしました");
});

// 初期描画
renderHistory();
updateChart();
