/**
 * Register planning tools for the AI.
 */
export function registerPlanningTools(registry, { planner }) {
  if (!planner) return;

  // 1. Create a plan.
  registry.register({
    name: 'create_plan',
    description: 'Create a multi-step execution plan for a complex task (e.g. build house, get iron armor, explore cave).',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Overall goal of the plan' },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered list of concrete steps to achieve the goal',
        },
      },
      required: ['goal', 'steps'],
    },
    handler: async (args) => {
      try {
        const plan = planner.createPlan(args.goal, args.steps);
        const stepsText = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
        return {
          success: true,
          data: `Plan created:\nGoal: ${plan.goal}\nSteps:\n${stepsText}`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 2. Get the current plan.
  registry.register({
    name: 'get_current_plan',
    description: 'Get the status and steps of the currently active plan.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const plan = planner.getActivePlan();
        if (!plan) return { success: true, data: 'There is no active plan right now.' };

        const stepsText = plan.steps
          .map((s, i) => {
            const mark = s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '►' : s.status === 'failed' ? '✗' : '○';
            return `${mark} Step ${i + 1}: ${s.description} [${s.status}]`;
          })
          .join('\n');

        return {
          success: true,
          data: `Plan "${plan.goal}" (${plan.status}):\n${stepsText}`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 3. Complete a plan step.
  registry.register({
    name: 'complete_step',
    description: 'Mark the current plan step as completed and advance to the next step.',
    parameters: {
      type: 'object',
      properties: {
        stepIndex: { type: 'number', description: 'Index of the completed step (0-based)' },
        result: { type: 'string', description: 'Outcome or result of the step' },
      },
      required: ['stepIndex'],
    },
    handler: async (args) => {
      try {
        const plan = planner.completeStep(args.stepIndex, args.result || 'Done');
        if (!plan) return { success: false, error: 'No active plan found.' };

        if (plan.status === 'completed') {
          return { success: true, data: `All steps in the plan "${plan.goal}" have been completed successfully!` };
        }

        const nextStep = plan.steps[plan.currentStepIndex];
        return {
          success: true,
          data: `Step ${args.stepIndex + 1} completed. Next step ${plan.currentStepIndex + 1}: "${nextStep.description}"`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 4. Revise the plan after an error.
  registry.register({
    name: 'revise_plan',
    description: 'Revise the remaining steps of the plan when an unexpected obstacle or failure occurs.',
    parameters: {
      type: 'object',
      properties: {
        newSteps: {
          type: 'array',
          items: { type: 'string' },
          description: 'New remaining steps to complete the goal',
        },
      },
      required: ['newSteps'],
    },
    handler: async (args) => {
      try {
        const plan = planner.revisePlan(args.newSteps);
        if (!plan) return { success: false, error: 'There is no active plan to revise.' };

        return {
          success: true,
          data: `Plan updated. Remaining steps: ${plan.steps.length - plan.currentStepIndex}`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });

  // 5. Cancel the plan.
  registry.register({
    name: 'cancel_plan',
    description: 'Cancel the current plan and stop all associated actions.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for cancelling the plan' },
      },
    },
    handler: async (args) => {
      try {
        const success = planner.cancelPlan(args.reason || 'Cancelled');
        return {
          success,
          data: success ? 'The current plan was cancelled.' : 'There is no active plan.',
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  });
}
