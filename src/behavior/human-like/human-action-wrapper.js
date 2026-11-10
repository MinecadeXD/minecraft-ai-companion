/**
 * Action wrapper integrated with the human-like behavior system
 */

export class HumanActionWrapper {
  constructor(humanController, bot) {
    this.humanController = humanController;
    this.bot = bot;
  }

  /**
   * Execute an action with checks from the human-like behavior system
   */
  async executeAction(action, originalExecutor, context = {}) {
    if (!this.humanController) {
      // Fallback — execute directly
      return await originalExecutor(action);
    }

    // Check the action through the human-like behavior system
    const actionResult = await this.humanController.processAction(action, {
      ...context,
      health: this.bot?.health,
      food: this.bot?.food,
      position: this.bot?.entity?.position,
    });

    if (!actionResult.allowed) {
      // Action was deferred
      return {
        executed: false,
        reason: actionResult.reason,
        retry: actionResult.delay || 5000,
      };
    }

    // Add a natural reaction delay
    await this._sleep(actionResult.reactionTime);

    // Thinking pause
    if (actionResult.pauseBefore) {
      await this._sleep(actionResult.pauseBefore);
    }

    // Execute the action
    const result = await originalExecutor(action);

    // Error reactions
    if (actionResult.mistake && this.bot?.chat) {
      for (const reaction of actionResult.reactions) {
        if (reaction) {
          await this.bot.chat(reaction);
        }
      }
    }

    return {
      ...result,
      executed: true,
      mistake: actionResult.mistake,
      modifications: actionResult.modifications,
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
