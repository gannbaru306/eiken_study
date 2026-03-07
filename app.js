let allData = [];
let currentSet = [];
let index = 0;
let combo = 0;
let totalScore = 0;
let timerId = null;
let startTime = 0;
let history = [];

const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const maxInfo = document.getElementById('max-info');
const startBtn = document.getElementById('start-btn');
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

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];

  const splitLine = (line) =>
    line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(s => s.replace(/^"|"$/g, '')) || [];

  const header = splitLine(lines[0]);
  const levelIdx   = header.indexOf('level');
  const wordIdx    = header.indexOf('word');
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
      level:   cols[levelIdx],
      word:    cols[wordIdx],
      meaning: cols[meaningIdx]
    });
  }

  return data;
}

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
  const r = document.querySelector('input[name="level"]:checked');
  return r ? r.value : '5';
}

function getDirection() {
  const r = document.querySelector('input[name="direction"]:checked');
  return r ? r.value : 'en2ja';
}

function getMode() {
  const r = document.querySelector('input[name="mode"]:checked');
  return r ? r.value : 'self';
}

function updateMaxInfo() {
  if (!allData.length) {
    maxInfo.textContent = '';
    return;
  }
  const lv = getSelectedLevel();
  const filtered = allData.filter(d => d.level === lv);
  maxInfo.textContent = `（この級の最大問題数：${filtered.length}）`;
}

document.querySelectorAll('input[name="level"]').forEach(r => {
  r.addEventListener('change', updateMaxInfo);
});

startBtn.addEventListener('click', () => {
  if (!allData.length) {
    alert('先にCSVファイルを読み込んでください。');
    return;
  }
  const lv = getSelectedLevel();
  const filtered = allData.filter(d => d.level === lv);
  if (!filtered.length) {
    alert(`${lv}級のデータがありません。`);
    return;
  }
  let n = parseInt(questionCountInput.value, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > filtered.length) n = filtered.length;
  questionCountInput.value = n;

  currentSet = filtered.slice().sort(() => Math.random() - 0.5).slice(0, n);
  index = 0;
  combo = 0;
  totalScore = 0;
  history = [];
  quizPanel.style.display = 'block';
  answerText.style.display = 'none';
  scoreInfo.textContent = 'スコア: 0';
  renderHistory();
  showQuestion();
});

function speak(text) {
  if (!window.speechSynthesis) return;
  const uttr = new SpeechSynthesisUtterance(text);
  uttr.lang = 'en-US';
  speechSynthesis.speak(uttr);
}

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

function calcBaseScore(elapsedSec) {
  const t = Math.max(0, Math.min(20, elapsedSec));
  const base = 1000 * (1 - t / 20);
  return Math.round(base);
}

function showQuestion() {
  const q = currentSet[index];
  const direction = getDirection();
  const mode = getMode();

  let actualDir = direction;
  if (direction === 'random') {
    actualDir = Math.random() < 0.5 ? 'en2ja' : 'ja2en';
  }

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
    judgeButtons.style.display = 'block';
  } else {
    showAnswerBtn.style.display = 'none';
    judgeButtons.style.display = 'none';
    setupChoices(q, actualDir);
  }

  if (actualDir === 'en2ja') {
    speak(question);
  }

  startTimer();
}

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
      const isCorrect = opt === correct;
      handleAnswer(isCorrect, false);
    });
    choicesEl.appendChild(btn);
  });
}

showAnswerBtn.addEventListener('click', () => {
  answerText.style.display = 'block';
});

correctBtn.addEventListener('click', () => handleAnswer(true, false));
wrongBtn.addEventListener('click', () => handleAnswer(false, false));

function handleAnswer(isCorrect, timeout) {
  clearInterval(timerId);
  const elapsed = (performance.now() - startTime) / 1000;
  const baseScore = isCorrect ? calcBaseScore(elapsed) : 0;
  const comboBefore = combo;

  if (isCorrect && !timeout) {
    combo++;
  } else {
    combo = 0;
  }

  const added = isCorrect ? baseScore * Math.max(1, comboBefore || 1) : 0;
  totalScore += added;

  scoreInfo.textContent = `スコア: ${totalScore}`;
  comboInfo.textContent = `コンボ: ${combo}`;

  const q = currentSet[index];
  const direction = getDirection();
  let actualDir = direction;
  if (direction === 'random') {
    actualDir = (questionText.textContent === q.word) ? 'en2ja' : 'ja2en';
  }

  const record = {
    no: history.length + 1,
    level: q.level,
    direction: actualDir,
    question: questionText.textContent,
    answer: answerText.textContent,
    correct: isCorrect && !timeout,
    time: Math.min(20, elapsed).toFixed(2),
    baseScore,
    combo: comboBefore || (isCorrect ? 1 : 0),
    added
  };
  history.push(record);
  renderHistory();

  index++;
  if (index >= currentSet.length) {
    alert(`終了！ スコア: ${totalScore}`);
    quizPanel.style.display = 'none';
  } else {
    showQuestion();
  }
}

function renderHistory() {
  historyTableBody.innerHTML = '';
  history.forEach(r => {
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
    `;
    historyTableBody.appendChild(tr);
  });
}
