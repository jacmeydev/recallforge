// ============================================================================
// RecallForge — in-chat study widget (MCP App)
// ============================================================================
// Rendered by MCP Apps hosts inside the conversation. Talks to the server only
// through tools (widget_next, widget_reveal, widget_grade, widget_undo,
// widget_correct) and to the agent through sendMessage / updateModelContext.
// ============================================================================

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ProgressMap } from '@/lib/core/progress';
import type { GradeResult, NextCardResult, RevealResult } from '@/lib/core/study';
import type { Rating } from '@/lib/core/types';
import { renderRichText } from '@/lib/ui/rich-text';

type Filter = { deck?: string; tag?: string; mode?: 'normal' | 'exam' | 'quick'; format?: 'recall' | 'typing' | 'multiple_choice' | 'true_false' };
type Images = Record<string, string>;

const QUICK_SIZE = 10;
const RATINGS: Array<{ rating: Rating; label: string; key: string }> = [
  { rating: 'again', label: 'Otra vez', key: '1' },
  { rating: 'hard', label: 'Difícil', key: '2' },
  { rating: 'good', label: 'Bien', key: '3' },
  { rating: 'easy', label: 'Fácil', key: '4' },
];
const RATING_LABEL: Record<Rating, string> = { again: 'Otra vez', hard: 'Difícil', good: 'Bien', easy: 'Fácil' };

const state = {
  view: 'loading' as 'loading' | 'study' | 'progress',
  filter: {} as Filter,
  queue: null as NextCardResult | null,
  reveal: null as RevealResult | null,
  practice: null as { result: GradeResult; next: NextCardResult; nextImages: Images } | null,
  images: {} as Images,
  answer: '',
  busy: false,
  error: '',
  notice: '',
  shownAt: Date.now(),
  reviewed: 0,
  correct: 0,
  failed: [] as Array<{ id: string; front: string; back: string }>,
  last: null as null | { id: string; rating: Rating; front: string },
  progress: null as ProgressMap | null,
};

const root = document.getElementById('app')!;
const app = new App({ name: 'RecallForge', version: '3.0.0' });

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (text: string | undefined | null) => renderRichText(text ?? '', (id) => state.images[id] ?? null);
const isPractice = () => state.filter.format === 'multiple_choice' || state.filter.format === 'true_false';
const pct = (value: number) => `${Math.round(value * 100)}%`;

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await app.callServerTool({ name, arguments: args });
  const text = (res.content?.[0] as { text?: string } | undefined)?.text;
  if (res.isError) throw new Error(text || 'Error');
  return res.structuredContent as T;
}

function filterArgs(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state.filter).filter(([, value]) => value !== undefined));
}

async function act(fn: () => Promise<void>) {
  if (state.busy) return;
  state.busy = true;
  state.error = '';
  render();
  try {
    await fn();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function showNext(next: NextCardResult, images: Images) {
  state.queue = next;
  state.images = { ...state.images, ...images };
  state.reveal = null;
  state.practice = null;
  state.answer = '';
  state.shownAt = Date.now();
}

// ── Actions ───────────────────────────────────────────────────────────────
const reveal = () =>
  act(async () => {
    const card = state.queue?.card;
    if (!card || state.reveal) return;
    const data = await call<{ reveal: RevealResult; images: Images }>('widget_reveal', { card_id: card.id });
    state.images = { ...state.images, ...data.images };
    state.reveal = data.reveal;
  });

const grade = (rating: Rating) =>
  act(async () => {
    const card = state.queue?.card;
    if (!card || !state.reveal) return;
    const data = await call<{ result: GradeResult; next: NextCardResult; images: Images }>('widget_grade', {
      card_id: card.id,
      rating,
      answer: state.answer.trim() || undefined,
      duration_ms: Date.now() - state.shownAt,
      ...filterArgs(),
    });
    state.reviewed++;
    if (rating === 'again') state.failed.push({ id: card.id, front: card.front, back: state.reveal.card.back });
    else state.correct++;
    state.last = { id: card.id, rating, front: card.front };
    state.notice = data.result.leech ? 'Esta tarjeta se olvida una y otra vez: pulsa «Mejorar tarjeta» en la siguiente ocasión.' : '';
    showNext(data.next, data.images);
    void reportToModel();
  });

const answerPractice = (input: { choice?: string; answer_true?: boolean }) =>
  act(async () => {
    const card = state.queue?.card;
    if (!card || state.practice) return;
    const [revealed, graded] = await Promise.all([
      call<{ reveal: RevealResult; images: Images }>('widget_reveal', { card_id: card.id }),
      call<{ result: GradeResult; next: NextCardResult; images: Images }>('widget_grade', {
        card_id: card.id,
        ...input,
        statement: state.queue?.presentation?.statement,
        duration_ms: Date.now() - state.shownAt,
        ...filterArgs(),
      }),
    ]);
    state.images = { ...state.images, ...revealed.images };
    state.reveal = revealed.reveal;
    state.practice = { result: graded.result, next: graded.next, nextImages: graded.images };
    state.reviewed++;
    if (graded.result.check?.correct) state.correct++;
    else state.failed.push({ id: card.id, front: card.front, back: revealed.reveal.card.back });
    void reportToModel();
  });

const undo = () =>
  act(async () => {
    if (!state.last) return;
    const data = await call<{ card: NonNullable<NextCardResult['card']>; images: Images }>('widget_undo', { card_id: state.last.id });
    if (state.last.rating === 'again') state.failed = state.failed.filter((f) => f.id !== state.last!.id);
    else state.correct = Math.max(0, state.correct - 1);
    state.reviewed = Math.max(0, state.reviewed - 1);
    showNext({ ...(state.queue as NextCardResult), card: data.card, presentation: undefined }, data.images);
    state.last = null;
    state.notice = 'Deshecho: la tarjeta vuelve como estaba.';
  });

const overrule = () =>
  act(async () => {
    if (!state.last) return;
    await call('widget_correct', { card_id: state.last.id, rating: 'good' });
    // The queue was computed with the old grade: refresh it unless the learner is mid-answer.
    if (!state.reveal && !state.answer.trim()) {
      const data = await call<{ next: NextCardResult; images: Images }>('widget_next', filterArgs());
      showNext(data.next, data.images);
    }
    state.failed = state.failed.filter((f) => f.id !== state.last!.id);
    state.correct++;
    state.last = { ...state.last, rating: 'good' };
    state.notice = 'Corregido a «Bien».';
    void reportToModel();
  });

function askAgent(text: string) {
  void app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }).catch(() => {
    state.error = 'Este chat no permite enviar mensajes desde el widget: escríbeselo al agente.';
    render();
  });
}

function cardSummary(): string {
  const card = state.reveal?.card;
  const question = state.queue?.card?.front ?? '';
  return card ? `«${question}» → «${card.back}» (card_id ${card.id})` : `«${question}» (card_id ${state.queue?.card?.id})`;
}

const explain = () =>
  askAgent(`Explícame esta tarjeta de RecallForge: ${cardSummary()}. Usa explain_card, apóyate en la fuente y dime por qué es así, con un ejemplo o una regla para recordarlo.${state.answer.trim() ? ` Yo respondí: «${state.answer.trim()}».` : ''}`);

const improve = () =>
  askAgent(`Esta tarjeta de RecallForge me cuesta o no me convence: ${cardSummary()}. Revísala (explain_card) y propón cómo mejorarla (dividirla, aclarar la pregunta, añadir una mnemotecnia); no la cambies hasta que yo acepte.`);

const judgeTyped = () =>
  askAgent(`Corrige mi respuesta a esta tarjeta de RecallForge por significado (acepta sinónimos): ${cardSummary()}. Mi respuesta: «${state.answer.trim()}». Dime si es correcta y qué me faltó.`);

async function reportToModel() {
  const lines = [
    `RecallForge study widget — ${state.reviewed} answered, ${state.correct} right${isPractice() ? ' (practice, schedule unchanged)' : ''}.`,
    state.failed.length ? `Failed: ${state.failed.slice(-10).map((f) => `"${f.front}" → "${f.back}" (${f.id})`).join('; ')}` : '',
  ].filter(Boolean);
  try {
    await app.updateModelContext({ content: [{ type: 'text', text: lines.join('\n') }] });
  } catch {
    // Hosts may not support context updates; the session still works.
  }
}

const finishWithTutor = () =>
  askAgent(
    `Terminé mi sesión de RecallForge: ${state.reviewed} tarjetas, ${state.correct} bien.${
      state.failed.length ? ` Fallé: ${state.failed.map((f) => `«${f.front}» (→ ${f.back})`).join('; ')}.` : ''
    } Dame un resumen breve de qué repasar y explícame en 2-3 líneas lo que fallé.`
  );

function restart(filter: Filter) {
  state.filter = filter;
  state.reviewed = 0;
  state.correct = 0;
  state.failed = [];
  state.last = null;
  state.view = 'study';
  void act(async () => {
    const data = await call<{ next: NextCardResult; images: Images }>('widget_next', filterArgs());
    showNext(data.next, data.images);
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────
function render() {
  if (state.view === 'progress' && state.progress) root.innerHTML = renderProgress(state.progress);
  else if (state.view === 'study' && state.queue) root.innerHTML = renderStudy();
  else root.innerHTML = `<div class="card muted">${state.error ? `<div class="error">${esc(state.error)}</div>` : 'Cargando…'}</div>`;
  bind();
}

function renderStudy(): string {
  const q = state.queue!;
  const quickDone = state.filter.mode === 'quick' && state.reviewed >= QUICK_SIZE && !state.practice;
  const remaining = q.remaining.learning + q.remaining.review + q.remaining.new;
  if ((!q.card && !state.practice) || quickDone) {
    const rate = state.reviewed ? ` · ${pct(state.correct / state.reviewed)}` : '';
    return `<div class="card done">
      <h2>${state.reviewed ? `¡Sesión terminada! ${state.reviewed} ${state.reviewed === 1 ? 'tarjeta' : 'tarjetas'}${rate}` : 'Nada pendiente'}</h2>
      <p class="muted">${esc(quickDone ? `Quedan ${remaining} para otra sesión.` : q.message ?? '')}</p>
      ${state.failed.length ? `<p class="muted">Para repasar: ${state.failed.slice(0, 5).map((f) => esc(f.front)).join(' · ')}</p>` : ''}
      <div class="actions">
        ${state.reviewed ? '<button class="ghost" data-act="tutor">Resumen y explicación del tutor</button>' : ''}
        ${state.last && !isPractice() ? '<button class="ghost" data-act="undo">Deshacer la última</button>' : ''}
        ${state.last && !isPractice() && (state.last.rating === 'again' || state.last.rating === 'hard') ? '<button class="ghost" data-act="overrule">Mi respuesta era correcta</button>' : ''}
        <button class="ghost" data-act="practice-mc">Practicar con opción múltiple</button>
      </div>
      ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}
      ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
    </div>`;
  }

  const card = state.practice ? state.reveal!.card : q.card!;
  const r = state.reveal;
  const counts =
    state.filter.mode === 'quick'
      ? `${Math.min(state.reviewed + 1, QUICK_SIZE)} de ${Math.min(QUICK_SIZE, state.reviewed + remaining)}`
      : `<span class="counts"><b class="c-learn">${q.remaining.learning}</b> · <b class="c-review">${q.remaining.review}</b> · <b class="c-new">${q.remaining.new}</b></span>`;
  const questionText = r?.card.revealed && !isPractice() ? r.card.revealed : q.card?.front ?? card.front;
  let body = '';

  if (isPractice()) body = renderPractice();
  else if (!r) {
    body = `<textarea id="answer" placeholder="${state.filter.format === 'typing' ? 'Escribe la respuesta…' : 'Escribe tu respuesta (opcional) — Enter para ver'}">${esc(state.answer)}</textarea>
      <button class="primary" data-act="reveal" ${state.busy ? 'disabled' : ''}>Mostrar respuesta <kbd>Enter</kbd></button>`;
  }

  if (r) {
    const typed = state.answer.trim();
    body += `<hr class="divider">
      ${typed ? `<div class="muted">Tu respuesta: «${esc(typed)}»</div>` : ''}
      ${r.card.kind === 'cloze' && !isPractice() ? '' : `<div class="answer rf-rich">${rich(r.card.back)}</div>`}
      ${r.card.cloze?.extra ? `<div class="extra rf-rich">${rich(r.card.cloze.extra)}</div>` : ''}
      ${r.card.explanation ? `<div class="explanation rf-rich">${rich(r.card.explanation)}</div>` : ''}
      ${renderSource(r)}
      ${
        state.practice
          ? `<button class="primary" data-act="continue">Siguiente <kbd>Enter</kbd></button>`
          : `<div class="grades">${RATINGS.map(
              ({ rating, label, key }) =>
                `<button class="grade ${rating}" data-grade="${rating}" ${state.busy ? 'disabled' : ''}>${label}<small>${esc(r.outcomes[rating].interval)} · ${key}</small></button>`
            ).join('')}</div>`
      }`;
  }

  const secondary = [
    '<button class="ghost" data-act="explain">Explícame</button>',
    r ? '<button class="ghost" data-act="improve">Mejorar tarjeta</button>' : '',
    r && state.answer.trim() && !isPractice() ? '<button class="ghost" data-act="judge">Que el tutor corrija mi respuesta</button>' : '',
    state.last && !isPractice() ? '<button class="ghost" data-act="undo">Deshacer <kbd>Z</kbd></button>' : '',
    state.last && !isPractice() && (state.last.rating === 'again' || state.last.rating === 'hard')
      ? '<button class="ghost" data-act="overrule">Mi respuesta anterior era correcta</button>'
      : '',
  ].join('');

  return `<div class="card">
    <div class="top"><span>${esc(card.deck.name)}${state.filter.mode === 'exam' ? ' · modo examen' : ''}${isPractice() ? ' · práctica' : ''}</span>${counts}</div>
    <div class="question rf-rich">${rich(questionText)}</div>
    ${body}
    <div class="actions">${secondary}</div>
    ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ''}
    ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
  </div>`;
}

function renderPractice(): string {
  const q = state.queue!;
  const checked = state.practice?.result.check;
  const verdict = checked ? `<div class="verdict ${checked.correct ? 'ok' : 'ko'}">${checked.correct ? '✓ Correcto' : '✗ Incorrecto'}</div>` : '';
  if (state.filter.format === 'multiple_choice') {
    const choices = q.presentation?.choices ?? [];
    return `${choices
      .map((choice, i) => {
        const cls = checked ? (choice === checked.expected ? 'right' : choice === checked.given ? 'wrong' : '') : '';
        return `<button class="choice ${cls}" data-choice="${i}" ${checked || state.busy ? 'disabled' : ''}><span class="letter">${String.fromCharCode(65 + i)}</span><span class="rf-rich">${rich(choice)}</span></button>`;
      })
      .join('')}${verdict}`;
  }
  return `<div class="muted" style="text-align:center">¿Es correcta esta respuesta?</div>
    <div class="answer rf-rich">${rich(q.presentation?.statement ?? '')}</div>
    ${checked ? verdict : `<div class="grades" style="grid-template-columns:1fr 1fr"><button class="grade good" data-tf="true">Verdadero <small>V</small></button><button class="grade again" data-tf="false">Falso <small>F</small></button></div>`}`;
}

function renderSource(r: RevealResult): string {
  const c = r.card;
  if (!c.document && !c.source && !c.excerpt) return '';
  const where = c.document ? `${esc(c.document.title)}${c.document.label ? `, ${esc(c.document.label)}` : ''}` : esc(c.source);
  return `<div class="source">Fuente: ${where}${c.excerpt ? `<blockquote>“${esc(c.excerpt)}”</blockquote>` : ''}</div>`;
}

function renderProgress(map: ProgressMap): string {
  const top = map.subjects.filter((s) => s.depth === 0);
  const exams = map.subjects.filter((s) => s.exam && !map.subjects.some((p) => p.id === s.parentId && p.exam?.date === s.exam?.date));
  return `<div class="card">
    <div class="tiles">
      <div class="tile"><b>${pct(map.overall.mastery)}</b><span>dominio</span></div>
      <div class="tile"><b>${map.workload.dueToday}</b><span>pendientes hoy</span></div>
      <div class="tile"><b>${map.workload.minutesToday} min</b><span>para hoy</span></div>
    </div>
    <button class="primary" data-start='${esc(JSON.stringify({}))}'>Estudiar ahora</button>
    ${
      map.recommendations.length
        ? `<h3>Qué hacer ahora</h3>${map.recommendations
            .slice(0, 4)
            .map((rec) => {
              const start =
                rec.kind === 'exam_at_risk' || rec.kind === 'unseen_before_exam'
                  ? { deck: rec.deckId, mode: 'exam' }
                  : rec.kind === 'due'
                    ? {}
                    : null;
              return `<div class="rec"><span>${esc(recText(rec, map))}</span>${start ? `<button class="ghost" data-start='${esc(JSON.stringify(start))}'>Empezar</button>` : ''}</div>`;
            })
            .join('')}`
        : ''
    }
    ${
      exams.length
        ? `<h3>Exámenes</h3>${exams
            .map(
              (s) =>
                `<div class="subject"><span class="name">${esc(s.name)} · ${s.exam!.daysLeft} días</span><span class="bar"><span style="width:${Math.round(s.exam!.predictedRecall * 100)}%"></span></span><span class="pct">${pct(s.exam!.predictedRecall)}</span></div>`
            )
            .join('')}`
        : ''
    }
    <h3>Materias</h3>
    ${
      top.length
        ? top
            .map(
              (s) =>
                `<div class="subject"><span class="name">${esc(s.name)} <span class="muted">${s.cards}</span></span><span class="bar"><span style="width:${Math.round(s.mastery * 100)}%"></span></span><span class="pct">${pct(s.mastery)}</span><button class="ghost" data-start='${esc(JSON.stringify({ deck: s.id }))}'>Estudiar</button></div>`
            )
            .join('')
        : '<p class="muted">Aún no hay materias. Pídele a tu agente que cree tarjetas desde tus apuntes.</p>'
    }
    ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
  </div>`;
}

function recText(rec: ProgressMap['recommendations'][number], map: ProgressMap): string {
  switch (rec.kind) {
    case 'exam_at_risk':
      return `Examen de ${rec.deck}: recuerdo previsto ${rec.count}%`;
    case 'unseen_before_exam':
      return `${rec.count} tarjetas de ${rec.deck} sin estudiar antes del examen`;
    case 'due':
      return `${rec.count} pendientes hoy (~${map.workload.minutesToday} min)`;
    case 'leeches':
      return `${rec.count} tarjetas de ${rec.deck} se olvidan una y otra vez`;
    case 'drafts':
      return `${rec.count} borradores por revisar`;
    case 'document_uncovered':
      return `${rec.count} partes de «${rec.document}» sin tarjetas`;
  }
}

function bind() {
  root.querySelectorAll<HTMLElement>('[data-act]').forEach((el) =>
    el.addEventListener('click', () => {
      switch (el.dataset.act) {
        case 'reveal':
          return void reveal();
        case 'continue':
          if (state.practice) {
            showNext(state.practice.next, state.practice.nextImages);
            render();
          }
          return;
        case 'undo':
          return void undo();
        case 'overrule':
          return void overrule();
        case 'explain':
          return explain();
        case 'improve':
          return improve();
        case 'judge':
          return judgeTyped();
        case 'tutor':
          return finishWithTutor();
        case 'practice-mc':
          return restart({ deck: state.filter.deck, tag: state.filter.tag, format: 'multiple_choice' });
      }
    })
  );
  root.querySelectorAll<HTMLElement>('[data-grade]').forEach((el) => el.addEventListener('click', () => void grade(el.dataset.grade as Rating)));
  root.querySelectorAll<HTMLElement>('[data-choice]').forEach((el) =>
    el.addEventListener('click', () => void answerPractice({ choice: state.queue?.presentation?.choices?.[Number(el.dataset.choice)] }))
  );
  root.querySelectorAll<HTMLElement>('[data-tf]').forEach((el) => el.addEventListener('click', () => void answerPractice({ answer_true: el.dataset.tf === 'true' })));
  root.querySelectorAll<HTMLElement>('[data-start]').forEach((el) => el.addEventListener('click', () => restart(JSON.parse(el.dataset.start || '{}'))));
  const answer = root.querySelector<HTMLTextAreaElement>('#answer');
  if (answer) {
    answer.addEventListener('input', () => (state.answer = answer.value));
    answer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void reveal();
      }
    });
    if (document.activeElement === document.body) answer.focus({ preventScroll: true });
  }
}

document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLTextAreaElement;
  if (typing || state.view !== 'study') return;
  if (state.practice && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    showNext(state.practice.next, state.practice.nextImages);
    return render();
  }
  if (isPractice()) {
    const choices = state.queue?.presentation?.choices;
    const index = 'abcd'.indexOf(event.key.toLowerCase());
    if (choices && index >= 0 && index < choices.length) void answerPractice({ choice: choices[index] });
    if (state.filter.format === 'true_false' && (event.key === 'v' || event.key === 'f')) void answerPractice({ answer_true: event.key === 'v' });
    return;
  }
  if (event.key === 'z' || event.key === 'Z') return void undo();
  if (!state.reveal && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    return void reveal();
  }
  if (state.reveal) {
    const option = RATINGS.find((r) => r.key === event.key);
    if (option) void grade(option.rating);
    else if (event.key === ' ') {
      event.preventDefault();
      void grade('good');
    }
  }
});

// ── Host wiring ───────────────────────────────────────────────────────────
function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (params) => {
  const data = params.structuredContent as
    | { view: 'study'; filter: Filter; next: NextCardResult; images: Images }
    | { view: 'progress'; progress: ProgressMap }
    | undefined;
  if (!data) {
    state.error = (params.content?.[0] as { text?: string } | undefined)?.text ?? 'Sin datos';
    return render();
  }
  if (data.view === 'progress') {
    state.view = 'progress';
    state.progress = data.progress;
  } else {
    state.view = 'study';
    state.filter = data.filter ?? {};
    showNext(data.next, data.images);
  }
  render();
};
app.onhostcontextchanged = (ctx) => applyContext(ctx as McpUiHostContext);

render();
app
  .connect()
  .then(() => applyContext(app.getHostContext()))
  .catch((error) => {
    state.error = `No se pudo conectar con el chat: ${error instanceof Error ? error.message : error}`;
    render();
  });
