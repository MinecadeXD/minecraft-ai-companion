import { createLogger } from '../utils/logger.js';
import { HumanErrorEngine } from '../behavior/human-error-engine.js';

const logger = createLogger('EMOTIONAL_MEMORY');

/**
 * EmotionalMemory — stores memories with emotions, not coordinates.
 * People remember "deep beneath the base," not "x:-234, y:-58, z:891."
 * People remember the EXPERIENCE, not just the facts.
 */
export class EmotionalMemory {
  constructor({ provider, agentName }) {
    this.provider = provider;
    this.agentName = agentName;
    this.memories = [];
    this.lastRecallTime = 0;
  }

  /**
   * Store a memory with its emotional context.
   * NOT structured data — a natural description of an experience.
   */
  async remember(event) {
    const {
      what,
      where,
      who,
      emotion,
      importance = 0.5,
      sensoryDetails = null,
    } = event;

    if (!what || !emotion) return null;

    const memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      what,
      where: where || 'somewhere in the world',
      when: this.describeTime(),
      who: who || 'alone',
      feeling: emotion,
      importance: Math.max(0, Math.min(1, importance)),
      sensory: sensoryDetails,
      timestamp: Date.now(),
      timesRecalled: 0,
    };

    this.memories.push(memory);

    if (this.memories.length > 100) {
      this.memories = this.memories
        .sort((a, b) => {
          const scoreA = a.importance * 0.7 + (a.timesRecalled / 10) * 0.3;
          const scoreB = b.importance * 0.7 + (b.timesRecalled / 10) * 0.3;
          return scoreB - scoreA;
        })
        .slice(0, 80);
    }

    logger.info(`[${this.agentName}] remembered: "${what}" (${emotion})`);
    return memory;
  }

  describeTime() {
    const now = Date.now();
    const minute = 60000;
    const hour = 3600000;
    const day = 86400000;

    return (timestamp) => {
      const diff = now - timestamp;
      if (diff < minute * 2) return 'just now';
      if (diff < minute * 10) return 'a few minutes ago';
      if (diff < hour) return 'recently';
      if (diff < hour * 3) return 'a couple of hours ago';
      if (diff < day) return 'today';
      if (diff < day * 2) return 'yesterday';
      if (diff < day * 7) return 'a few days ago';
      if (diff < day * 30) return 'a long time ago';
      return 'a very long time ago';
    };
  }

  /**
   * Associative recall — not an SQL search, but a natural memory surfacing.
   * Trigger → association → memory.
   */
  async recall(trigger, limit = 3) {
    const now = Date.now();

    if (now - this.lastRecallTime < 5000) return [];
    if (this.memories.length === 0) return [];

    this.lastRecallTime = now;

    const prompt = `You are ${this.agentName}.
Trigger: "${trigger}"

You have these memories:
${this.memories.slice(0, 20).map((m, i) =>
  `${i + 1}. ${m.what} (${m.feeling}, ${this.describeTime()(m.timestamp)})`
).join('\n')}

Which 1–3 memories NATURALLY come to mind in response to this trigger?
Reply ONLY with comma-separated numbers (for example: 3,7,12), or "none" if nothing comes to mind.`;

    try {
      const session = await this.provider.createChat({
        systemPrompt: 'You select associatively related memories. Reply only with numbers or "none".',
        tools: [],
      });

      const response = await this.provider.sendMessage(session, prompt, {
        temperature: 0.7,
        maxTokens: 20,
      });

      const text = (response.text || '').trim().toLowerCase();

      if (text === 'none' || text === 'no' || !text) return [];

      const indices = text
        .split(/[,\s]+/)
        .map(s => parseInt(s) - 1)
        .filter(i => i >= 0 && i < this.memories.length);

      const recalled = indices.map(i => this.memories[i]);

      recalled.forEach(m => {
        if (m) m.timesRecalled++;
      });

      logger.debug(`[${this.agentName}] recalled ${recalled.length} episodes for trigger "${trigger}"`);

      return recalled;
    } catch (err) {
      logger.debug(`Associative recall error: ${err.message}`);
      return this.memories
        .filter(m =>
          m.what.toLowerCase().includes(trigger.toLowerCase()) ||
          m.where.toLowerCase().includes(trigger.toLowerCase())
        )
        .slice(0, limit);
    }
  }

  /**
   * Random memory (surfaces spontaneously).
   */
  randomMemory() {
    if (this.memories.length === 0) return null;

    const memory = HumanErrorEngine.weightedChoice(
      this.memories,
      m => m.importance * 0.6 + (m.timesRecalled / 20) * 0.4
    ) || this.memories[0];

    memory.timesRecalled++;
    return memory;
  }

  /**
   * Format a memory for storytelling (not SQL output).
   */
  formatMemory(memory) {
    if (!memory) return null;

    let text = `${memory.what}`;

    if (memory.where && memory.where !== 'somewhere in the world') {
      text += ` — ${memory.where}`;
    }

    if (memory.who && memory.who !== 'alone') {
      text += `, ${memory.who}`;
    }

    text += ` (${memory.feeling})`;

    if (memory.sensory) {
      text += `. ${memory.sensory}`;
    }

    return text;
  }

  /**
   * Get the latest memories for context.
   */
  getRecentMemories(limit = 5) {
    return this.memories
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(m => this.formatMemory(m))
      .filter(Boolean);
  }

  /**
   * Clean up old, low-importance memories.
   */
  forget(memoryId) {
    this.memories = this.memories.filter(m => m.id !== memoryId);
  }

  getState() {
    return {
      totalMemories: this.memories.length,
      recent: this.getRecentMemories(3),
    };
  }
}
