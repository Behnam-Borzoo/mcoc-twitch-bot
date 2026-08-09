// -------------------- سیستم رأی‌گیری برای انتخاب Champion در BG --------------------

let currentPoll = null;
// currentPoll = { options: string[], votes: Map(username -> optionIndex), endTimer }

export function isPollActive() {
  return currentPoll !== null;
}

export function startPoll(optionsRaw, durationSeconds, onEnd) {
  const options = optionsRaw
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (options.length < 2) {
    return { ok: false, error: 'حداقل ۲ گزینه لازمه. مثال: !startvote Shathra, Photon, Kushala' };
  }
  if (options.length > 5) {
    return { ok: false, error: 'حداکثر ۵ گزینه مجازه.' };
  }
  if (currentPoll) {
    return { ok: false, error: 'یه رأی‌گیری همین الان فعاله. اول با !endvote تمومش کن.' };
  }

  currentPoll = {
    options,
    votes: new Map(),
  };

  if (durationSeconds > 0) {
    currentPoll.endTimer = setTimeout(() => {
      const result = endPoll();
      if (result) onEnd(result);
    }, durationSeconds * 1000);
  }

  const optionsList = options.map((o, i) => `${i + 1}) ${o}`).join('  ');
  return { ok: true, message: `🗳️ رأی‌گیری شروع شد! ${optionsList} — با !vote [شماره] رأی بده` };
}

export function castVote(username, optionNumber) {
  if (!currentPoll) return { ok: false, error: null }; // پول فعال نیست، بی‌سروصدا رد شو
  const index = optionNumber - 1;
  if (index < 0 || index >= currentPoll.options.length) {
    return { ok: false, error: `گزینه نامعتبره. بین ۱ تا ${currentPoll.options.length} انتخاب کن.` };
  }
  const alreadyVoted = currentPoll.votes.has(username);
  currentPoll.votes.set(username, index);
  return { ok: true, changed: alreadyVoted };
}

export function getTally() {
  if (!currentPoll) return null;
  const counts = currentPoll.options.map(() => 0);
  for (const optionIndex of currentPoll.votes.values()) {
    counts[optionIndex]++;
  }
  return currentPoll.options.map((opt, i) => ({ option: opt, votes: counts[i] }));
}

export function endPoll() {
  if (!currentPoll) return null;
  if (currentPoll.endTimer) clearTimeout(currentPoll.endTimer);

  const tally = getTally();
  const totalVotes = tally.reduce((sum, t) => sum + t.votes, 0);

  let winnerText;
  if (totalVotes === 0) {
    winnerText = '😶 هیچ رأیی ثبت نشد.';
  } else {
    const sorted = [...tally].sort((a, b) => b.votes - a.votes);
    const top = sorted[0];
    const tiedWinners = sorted.filter((t) => t.votes === top.votes);
    if (tiedWinners.length > 1) {
      winnerText = `🤝 مساوی شد بین: ${tiedWinners.map((t) => t.option).join(' و ')} (هرکدوم ${top.votes} رأی)`;
    } else {
      winnerText = `🏆 برنده: ${top.option} با ${top.votes} رأی!`;
    }
  }

  const breakdown = tally.map((t) => `${t.option}: ${t.votes}`).join('  |  ');
  const message = `⏹️ رأی‌گیری تموم شد. ${winnerText} (${breakdown})`;

  currentPoll = null;
  return message;
}
