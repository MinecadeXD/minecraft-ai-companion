/**
 * Mock AI provider for testing.
 */
export class MockAIProvider {
  constructor() {
    this.responses = [];
    this.callLog = [];
    this._responseIndex = 0;
  }

  get name() {
    return 'MockAI';
  }

  /** Add a predefined response */
  addResponse(response) {
    this.responses.push(response);
  }

  async createChat({ systemPrompt, tools }) {
    this.callLog.push({ method: 'createChat', systemPrompt, tools });
    return { id: 'mock-session' };
  }

  async sendMessage(session, message) {
    this.callLog.push({ method: 'sendMessage', session, message });
    return this._nextResponse();
  }

  async sendToolResults(session, results) {
    this.callLog.push({ method: 'sendToolResults', session, results });
    return this._nextResponse();
  }

  _nextResponse() {
    if (this._responseIndex < this.responses.length) {
      return this.responses[this._responseIndex++];
    }
    return { text: 'Mock default response', toolCalls: [], raw: {} };
  }

  /** Reset mock state */
  reset() {
    this.responses = [];
    this.callLog = [];
    this._responseIndex = 0;
  }
}
