const SPEECH_ACTS = Object.freeze(['greeting', 'question', 'thanks', 'apology', 'agreement', 'disagreement', 'request', 'conflict', 'farewell', 'casual', 'silence']);
const DOMAINS = Object.freeze(['social', 'information', 'assistance', 'conflict', 'none']);
const RISKS = Object.freeze(['none', 'low', 'medium', 'high']);
const CATEGORY_SET = new Set(SPEECH_ACTS);

/** Pure, text-only classification. It never produces a gameplay action. */
export function classifySocialMessage(message) {
  const text = typeof message === 'string' ? message.trim() : String(message?.content || '').trim();
  const lower = text.toLowerCase();
  let speechAct = 'casual';
  if (!text) speechAct = 'silence';
  else if (/^(hello|hi|hey|good morning|good afternoon|good evening)(?:\b|[,!.])/i.test(lower)) speechAct = 'greeting';
  else if (/\?$/.test(text) || /^(who|what|where|when|why|how|can you|could you|may i)\b/i.test(lower)) speechAct = 'question';
  else if (/(thanks|thank you|thx|appreciate it)/i.test(lower)) speechAct = 'thanks';
  else if (/(sorry|my bad|apologies|forgive me)/i.test(lower)) speechAct = 'apology';
  else if (/(help|assist|need a hand)/i.test(lower)) speechAct = 'request';
  else if (/(i disagree|no,|not really|i don't think|disagree)/i.test(lower)) speechAct = 'disagreement';
  else if (/(i agree|let's|okay|ok|right|sounds good)/i.test(lower)) speechAct = 'agreement';
  else if (/(you're annoying|shut up|idiot|conflict|i hate)/i.test(lower)) speechAct = 'conflict';
  else if (/^(bye|goodbye|see you|later)\b/i.test(lower)) speechAct = 'farewell';
  const domain = speechAct === 'question' ? 'information' : speechAct === 'request' ? 'assistance' : speechAct === 'conflict' ? 'conflict' : speechAct === 'silence' ? 'none' : 'social';
  const risk = speechAct === 'conflict' ? 'high' : speechAct === 'request' || speechAct === 'disagreement' ? 'medium' : speechAct === 'silence' ? 'none' : 'low';
  return Object.freeze({ speechAct: CATEGORY_SET.has(speechAct) ? speechAct : 'casual', domain, risk });
}

export { SPEECH_ACTS as SOCIAL_MESSAGE_SPEECH_ACTS, DOMAINS as SOCIAL_MESSAGE_DOMAINS, RISKS as SOCIAL_MESSAGE_RISKS };

const TOPICS = Object.freeze(['night', 'weather', 'danger', 'find', 'death', 'social', 'unknown']);
const TOPIC_SET = new Set(TOPICS);

/** Pure, text-only topic classification for scheduling and dedup. Never an action. */
export function classifyTopic(message) {
  const text = typeof message === 'string' ? message.trim() : String(message?.content || '').trim();
  const lower = text.toLowerCase();
  let topic = 'social';
  if (!text) topic = 'unknown';
  else if (/(getting dark|night|tonight|time to sleep|go to sleep|\bsleep\b|moon)/i.test(lower)) topic = 'night';
  else if (/(rain|storm|downpour|bad weather)/i.test(lower)) topic = 'weather';
  else if (/(careful|danger|creeper|skeleton|zombie|mob|death|killed)/i.test(lower)) topic = 'danger';
  else if (/(found|saw a village|diamond|iron|ore|village|mining|mine)/i.test(lower)) topic = 'find';
  else if (/(died|dead|passed away|respawn)/i.test(lower)) topic = 'death';
  return Object.freeze({ topic: TOPIC_SET.has(topic) ? topic : 'unknown' });
}

export { TOPICS as SOCIAL_TOPICS };
