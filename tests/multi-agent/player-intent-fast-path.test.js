import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastPlayerIntentRouter, PlayerIntents } from '../../src/control/fast-player-intent.js';
import { messageBus, MessageOrigin } from '../../src/events/message-bus.js';
import { MovementController } from '../../src/control/movement-controller.js';
import { AIBrain, AgentAIState } from '../../src/brain/ai-brain.js';
import { RecoveryController } from '../../src/recovery/recovery-controller.js';

describe('Phase 9 Architecture & Fast Player Intent (Acceptance Tests 1-13)', () => {
  let mockBot;

  beforeEach(() => {
    mockBot = {
      on: vi.fn(),
      removeListener: vi.fn(),
      chat: vi.fn(),
      clearControlStates: vi.fn(),
      setControlState: vi.fn(),
      entity: {
        position: { x: 100, y: 64, z: 200, distanceTo: vi.fn().mockReturnValue(2) },
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
        yaw: 0,
      },
      players: {
        kustash01: {
          username: 'kustash01',
          entity: {
            position: { x: 102, y: 64, z: 200, distanceTo: vi.fn().mockReturnValue(2) },
          },
        },
      },
      pathfinder: {
        isMoving: vi.fn().mockReturnValue(false),
        stop: vi.fn(),
        setGoal: vi.fn(),
      },
    };
  });

  // Criteria 1 & 2: Fast follow command with & without API
  it('Criterion 1 & 2: "Sam, follow me" acknowledges quickly and starts following without LLM', async () => {
    const movement = new MovementController({ agentName: 'Sam', bot: mockBot });
    const mockAgentInstance = {
      name: 'Sam',
      mcBot: { bot: mockBot },
      movementController: movement,
      currentTask: 'idle',
      preemptRuntimeForLegacy: vi.fn(),
    };

    const intent = FastPlayerIntentRouter.classifyIntent('Sam, follow me');
    expect(intent).toBe(PlayerIntents.FOLLOW);

    const res = await FastPlayerIntentRouter.executeLocally({
      agentInstance: mockAgentInstance,
      intent,
      playerUsername: 'kustash01',
    });

    expect(res.executed).toBe(true);
    expect(res.status).toBe('accepted');
    expect(res.responseDisposition).toBe('deferred');
    expect(res.ack).toBeNull();
    expect(movement.mode).toBe('following');
    expect(movement.targetPlayer).toBe('kustash01');
    expect(mockAgentInstance.currentTask).toBe('following_kustash01');
  });

  // Criteria 3: Immediate stop
  it('Criterion 3: "Sam, stop" stops movement immediately', async () => {
    const movement = new MovementController({ agentName: 'Sam', bot: mockBot });
    movement.mode = 'following';
    movement.targetPlayer = 'kustash01';

    const mockAgentInstance = {
      name: 'Sam',
      mcBot: { bot: mockBot },
      movementController: movement,
      currentTask: 'following_kustash01',
      preemptRuntimeForLegacy: vi.fn(),
    };

    const intent = FastPlayerIntentRouter.classifyIntent('Sam, stop');
    expect(intent).toBe(PlayerIntents.STOP);

    const res = await FastPlayerIntentRouter.executeLocally({
      agentInstance: mockAgentInstance,
      intent,
      playerUsername: 'kustash01',
    });

    expect(res.executed).toBe(true);
    expect(movement.mode).toBe('idle');
    expect(mockBot.pathfinder.stop).toHaveBeenCalled();
    expect(mockBot.clearControlStates).toHaveBeenCalled();
  });

  // Criteria 4 & 5: Wait and resume
  it('Criteria 4 & 5: "Sam, wait" pauses with wait-state, and "Sam, let's go" resumes', async () => {
    const movement = new MovementController({ agentName: 'Sam', bot: mockBot });
    const mockAgentInstance = {
      name: 'Sam',
      mcBot: { bot: mockBot },
      movementController: movement,
      currentTask: 'idle',
      preemptRuntimeForLegacy: vi.fn(),
    };

    // 1. Wait
    const waitIntent = FastPlayerIntentRouter.classifyIntent('Sam, wait');
    expect(waitIntent).toBe(PlayerIntents.WAIT);
    await FastPlayerIntentRouter.executeLocally({
      agentInstance: mockAgentInstance,
      intent: waitIntent,
      playerUsername: 'kustash01',
    });
    expect(movement.mode).toBe('waiting');
    expect(movement.isPaused).toBe(true);

    // 2. Resume
    const resumeIntent = FastPlayerIntentRouter.classifyIntent("Sam, let's go");
    expect(resumeIntent).toBe(PlayerIntents.FOLLOW);
    await FastPlayerIntentRouter.executeLocally({
      agentInstance: mockAgentInstance,
      intent: resumeIntent,
      playerUsername: 'kustash01',
    });
    expect(movement.mode).toBe('following');
    expect(movement.isPaused).toBe(false);
  });

  // Criteria 6: Addressing isolation (other agents do not activate)
  it('Criterion 6: "Ryan, stop" is ignored by Sam (not addressed to Sam)', () => {
    const allAgents = ['Sam', 'Max', 'Jack', 'Ryan', 'Alex', 'Leo'];
    const samAddressing = messageBus.checkAddressing('Ryan, stop', 'Sam', allAgents);
    expect(samAddressing.isAddressedToMe).toBe(false);
    expect(samAddressing.targetName).toBe('Ryan');

    const ryanAddressing = messageBus.checkAddressing('Ryan, stop', 'Ryan', allAgents);
    expect(ryanAddressing.isAddressedToMe).toBe(true);
    expect(ryanAddressing.targetName).toBe('Ryan');
  });

  // Criteria 7: Group command
  it('Criterion 7: "Guys, let's go" is recognized as a group command for all members', () => {
    const allAgents = ['Sam', 'Max', 'Jack', 'Ryan', 'Alex', 'Leo'];
    const addressing = messageBus.checkAddressing("Guys, let's go", 'Sam', allAgents);
    expect(addressing.isGroupMessage).toBe(true);
    expect(addressing.isAddressedToMe).toBe(true);

    const intent = FastPlayerIntentRouter.classifyIntent("Guys, let's go");
    expect(intent).toBe(PlayerIntents.FOLLOW);
  });

  // Criteria 8: Single messageId and deduplication
  it('Criterion 8: Message deduplication ensures one messageId is processed at most once per bot', () => {
    const msgId = messageBus.generateMessageId('kustash01', 'Hello!');
    const firstCheckSam = messageBus.markProcessed('Sam', msgId);
    const secondCheckSam = messageBus.markProcessed('Sam', msgId);

    expect(firstCheckSam).toBe(true);
    expect(secondCheckSam).toBe(false); // duplicate skipped!

    const firstCheckMax = messageBus.markProcessed('Max', msgId);
    expect(firstCheckMax).toBe(true); // Max gets it once
  });

  // Criteria 9: Invariant activeRequests <= 1
  it('Criterion 9: activeRequests <= 1 invariant prevents duplicate concurrent processing', async () => {
    const mockProvider = {
      createChat: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r({ text: 'Done' }), 100))),
    };
    const mockTools = { getFunctionDeclarations: () => [] };
    const mockContext = { buildContext: () => '', addToHistory: () => {} };

    const brain = new AIBrain({ ai: {} }, mockTools, mockContext, mockProvider);

    const p1 = brain.processMessage('Msg 1', {});
    const p2 = brain.processMessage('Msg 2', {});

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(brain.activeRequests).toBe(0);
    expect(r2).toContain("Wait, I'm still thinking");
  });

  // Criteria 10: Unresponsive recovery NEVER creates new LLM requests
  it('Criterion 10: Unresponsive recovery cancels in-flight LLM request and switches to LOCAL_MODE without new calls', () => {
    const mockProvider = {
      sendMessage: vi.fn(),
    };
    const brain = new AIBrain({ ai: {} }, { getFunctionDeclarations: () => [] }, { buildContext: () => '', addToHistory: () => {} }, mockProvider);
    brain.activeRequests = 1;
    brain.state = AgentAIState.WAITING_API;
    brain.currentAbortController = new AbortController();

    const recovery = new RecoveryController({
      agentName: 'Sam',
      bot: mockBot,
      aiBrain: brain,
      movementController: new MovementController({ agentName: 'Sam', bot: mockBot }),
    });

    recovery.recover({ type: 'unresponsive', data: { inactiveTime: 45000 } });

    expect(brain.activeRequests).toBe(0);
    expect(brain.state).toBe(AgentAIState.LOCAL_MODE);
    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
  });

  // Criteria 11: LLM timeout does not block movement
  it('Criterion 11: LLM timeout gracefully fails over to LOCAL_MODE while movement controller stays active', async () => {
    const mockProvider = {
      createChat: vi.fn().mockResolvedValue({}),
      sendMessage: vi.fn().mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 50))),
    };
    const brain = new AIBrain({ ai: {} }, { getFunctionDeclarations: () => [] }, { buildContext: () => '', addToHistory: () => {} }, mockProvider);
    brain.processTimeout = 50;

    const movement = new MovementController({ agentName: 'Sam', bot: mockBot });
    movement.followPlayer('kustash01', 3);

    const result = await brain.processMessage('Slow request', {});
    expect(result).toBeNull(); // Timeout handled gracefully
    expect(brain.state).toBe(AgentAIState.LOCAL_MODE);
    expect(movement.mode).toBe('following'); // Movement unaffected!
  });

  it('keeps the formation goal stable while the owner stands still', async () => {
    const movement = new MovementController({ agentName: 'Sam', bot: mockBot });
    const setGoal = vi.spyOn(mockBot.pathfinder, 'setGoal');
    mockBot.players.kustash01.entity.yaw = 0;

    await movement.followPlayer('kustash01', 3);
    await movement._updateFormationGoal();

    expect(setGoal).toHaveBeenCalledTimes(1);
  });

  // Criteria 12 & 13: Exploration not default and idle stays near
  it('Criteria 12 & 13: Idle behavior stays near base/player and does not wander off randomly', () => {
    const movement = new MovementController({ agentName: 'Sam', bot: mockBot });
    movement.mode = 'idle';

    const playerPos = { x: 100, y: 64, z: 200 };
    mockBot.entity.position = { x: 115, y: 64, z: 200, distanceTo: () => 15 }; // 15 blocks away

    movement.stayNear(playerPos, 6);
    expect(movement.mode).toBe('moving_to');
    expect(movement.destination).toEqual({ x: 100, y: 64, z: 200 });
  });
});
