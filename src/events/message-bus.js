import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MESSAGE_BUS');

export const MessageOrigin = {
  PLAYER: 'PLAYER',
  BOT_REAL_CHAT: 'BOT_REAL_CHAT',
  SYSTEM: 'SYSTEM',
  INTERNAL: 'INTERNAL',
};

export const MessageChannel = {
  PUBLIC: 'public',
  WHISPER: 'whisper',
  SYSTEM: 'system',
  INTERNAL: 'internal',
};

/**
 * MessageBus — a unified message bus with provenance tracking,
 * message deduplication, and a strict separation between receiving and sending.
 */
export class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.seenMessageIds = new Set();
    this.maxSeenCache = 1000;
    this.agentSeenMap = new Map(); // agentName -> Set<messageId>
    this.responseClaims = new Set();
  }

  /**
   * Generate a unique message ID
   */
  generateMessageId(sender, content, timestamp = Date.now()) {
    // Stable short-lived id: duplicate event emissions for the same chat line
    // must address one logical message, even when handlers run milliseconds apart.
    const bucket = Math.floor(timestamp / 2000);
    return `${sender}:${bucket}:${String(content).trim().toLowerCase()}`;
  }

  /**
   * Publish a message received from Minecraft chat (chat_received)
   * @param {Object} payload
   * @param {string} payload.sender
   * @param {string} payload.content
   * @param {string} [payload.origin]
   * @param {string} [payload.channel]
   * @param {string} [payload.target]
   */
  emitChatReceived({
    sender,
    content,
    origin = MessageOrigin.PLAYER,
    channel = MessageChannel.PUBLIC,
    target = null,
    timestamp = Date.now(),
    messageId = null,
  }) {
    const stableMessageId = messageId || this.generateMessageId(sender, content, timestamp);

    const message = {
      messageId: stableMessageId,
      sender,
      content,
      origin,
      channel,
      target,
      timestamp,
    };

    logger.debug(`[CHAT_RECEIVED] (${origin}) ${sender}: "${content}" [id: ${stableMessageId}]`);
    this.emit('chat_received', message);
    return message;
  }

  /**
   * Check whether a specific agent has already processed this message (deduplication)
   * @param {string} agentName
   * @param {string} messageId
   * @returns {boolean} true if the message is new, false if it is a duplicate
   */
  markProcessed(agentName, messageId) {
    if (!this.agentSeenMap.has(agentName)) {
      this.agentSeenMap.set(agentName, new Set());
    }

    const seen = this.agentSeenMap.get(agentName);
    if (seen.has(messageId)) {
      return false; // Already processed
    }

    seen.add(messageId);
    if (seen.size > 200) {
      const first = seen.values().next().value;
      seen.delete(first);
    }
    return true; // New message
  }

  /** Allow one natural-language responder for an unaddressed chat line. */
  claimResponse(messageId) {
    if (this.responseClaims.has(messageId)) return false;
    this.responseClaims.add(messageId);
    if (this.responseClaims.size > this.maxSeenCache) {
      const first = this.responseClaims.values().next().value;
      this.responseClaims.delete(first);
    }
    return true;
  }

  /**
   * Check message addressing: is it addressed to a specific agent, a group, or everyone?
   * @param {string} content
   * @param {string} agentName
   * @param {string[]} allAgentNames
   * @returns {{ isAddressedToMe: boolean, isGroupMessage: boolean, targetName: string|null }}
   */
  checkAddressing(content, agentName, allAgentNames = []) {
    const lower = content.toLowerCase().trim();
    const myNameLower = agentName.toLowerCase();
    const aliases = {
      sam: ['sammy'],
      max: ['maxim'],
      jack: ['jackie'],
      ryan: [],
      alex: ['sasha'],
      leo: ['leon'],
    };
    const hasAddress = (name) => {
      const names = [name.toLowerCase(), ...(aliases[name.toLowerCase()] || [])];
      return names.some((alias) => new RegExp(`(^|\\s)${alias}(?=($|[\\s,!?:;.]))`, 'i').test(lower));
    };

    // 1. Check for a direct mention of a bot (for example: "Sam,", "Sam ", "Sam!")
    if (hasAddress(agentName)) {
      return { isAddressedToMe: true, isGroupMessage: false, targetName: agentName, routing: { kind: 'direct', recipientIds: [agentName] } };
    }

    // 2. Check whether another specific bot was addressed
    for (const other of allAgentNames) {
      if (other.toLowerCase() === myNameLower) continue;
      if (hasAddress(other)) {
        return { isAddressedToMe: false, isGroupMessage: false, targetName: other, routing: { kind: 'named', recipientIds: [other] } };
      }
    }

    // 3. Check for a group-wide message
    const groupKeywords = ['guys', 'folks', 'bots', 'everyone', 'all', 'team', 'friends'];
    const isGroup = groupKeywords.some(kw => lower.includes(kw));

    return {
      isAddressedToMe: isGroup || false,
      isGroupMessage: isGroup,
      targetName: isGroup ? 'group' : null,
      routing: { kind: isGroup ? 'group' : 'public', recipientIds: isGroup ? allAgentNames.filter((name) => name !== agentName) : [] },
    };
  }
}

export const messageBus = new MessageBus();
