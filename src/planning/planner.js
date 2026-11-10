import { createLogger } from '../utils/logger.js';

const logger = createLogger('PLAN');

export class Planner {
  constructor(memoryManager, toolRegistry, aiBrain) {
    this.memoryManager = memoryManager;
    this.toolRegistry = toolRegistry;
    this.aiBrain = aiBrain;
    this.activePlan = null;
    this.isExecuting = false;
  }

  /**
   * Create a structured plan.
   * @param {string} goal - Main goal of the plan
   * @param {Array<string>} stepDescriptions - List of steps
   * @returns {Object} plan object
   */
  createPlan(goal, stepDescriptions) {
    const plan = {
      id: 'plan_' + Date.now(),
      goal,
      status: 'in_progress',
      createdAt: Date.now(),
      currentStepIndex: 0,
      steps: stepDescriptions.map((desc, idx) => ({
        index: idx,
        description: desc,
        status: 'pending',
        result: null,
      })),
    };

    if (plan.steps.length > 0) {
      plan.steps[0].status = 'in_progress';
    }

    this.activePlan = plan;
    if (this.memoryManager) {
      this.memoryManager.shortTerm.setPlan(plan);
      this.memoryManager.shortTerm.setTask(goal);
    }

    logger.info(`[PLAN CREATED] Goal: "${goal}" (${plan.steps.length} steps)`);
    for (let i = 0; i < plan.steps.length; i++) {
      logger.info(`  ${i + 1}. ${plan.steps[i].description}`);
    }

    return plan;
  }

  /**
   * Get the current active plan.
   */
  getActivePlan() {
    return this.activePlan;
  }

  /**
   * Mark a step as completed and move to the next one.
   */
  completeStep(index, result = null) {
    if (!this.activePlan || !this.activePlan.steps[index]) return null;

    this.activePlan.steps[index].status = 'completed';
    this.activePlan.steps[index].result = result;
    logger.info(`[STEP COMPLETED] Step ${index + 1}: ${this.activePlan.steps[index].description}`);

    const nextIndex = index + 1;
    if (nextIndex < this.activePlan.steps.length) {
      this.activePlan.currentStepIndex = nextIndex;
      this.activePlan.steps[nextIndex].status = 'in_progress';
      logger.info(`[NEXT STEP] Step ${nextIndex + 1}: ${this.activePlan.steps[nextIndex].description}`);
    } else {
      this.activePlan.status = 'completed';
      logger.info(`🎉 [PLAN COMPLETED] Goal "${this.activePlan.goal}" achieved successfully!`);
    }

    if (this.memoryManager) {
      this.memoryManager.shortTerm.setPlan(this.activePlan);
    }

    return this.activePlan;
  }

  /**
   * Mark a step as failed.
   */
  failStep(index, error = null) {
    if (!this.activePlan || !this.activePlan.steps[index]) return null;

    this.activePlan.steps[index].status = 'failed';
    this.activePlan.steps[index].result = error;
    this.activePlan.status = 'failed';
    logger.warn(`❌ [STEP FAILED] Step ${index + 1}: ${this.activePlan.steps[index].description} (${error || 'error'})`);

    if (this.memoryManager) {
      this.memoryManager.shortTerm.setPlan(this.activePlan);
    }

    return this.activePlan;
  }

  /**
   * Revise the plan when obstacles arise.
   */
  revisePlan(newSteps) {
    if (!this.activePlan) return null;

    logger.info(`[PLAN REVISION] Replacing the old plan with ${newSteps.length} new steps`);
    const completed = this.activePlan.steps.filter(s => s.status === 'completed');

    const freshSteps = newSteps.map((desc, idx) => ({
      index: completed.length + idx,
      description: desc,
      status: idx === 0 ? 'in_progress' : 'pending',
      result: null,
    }));

    this.activePlan.steps = [...completed, ...freshSteps];
    this.activePlan.currentStepIndex = completed.length;
    this.activePlan.status = 'in_progress';

    if (this.memoryManager) {
      this.memoryManager.shortTerm.setPlan(this.activePlan);
    }

    return this.activePlan;
  }

  /**
   * Cancel the current plan.
   */
  cancelPlan(reason = 'Cancelled by user') {
    if (!this.activePlan) return false;

    this.activePlan.status = 'cancelled';
    logger.warn(`[PLAN CANCELLED] Reason: ${reason}`);
    this.activePlan = null;

    if (this.memoryManager) {
      this.memoryManager.shortTerm.clearTask();
    }

    return true;
  }
}
