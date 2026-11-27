import type { EventBus, GameScreenId } from '../core/EventBus';

export class GameStateMachine {
  private current: GameScreenId = 'main_menu';

  constructor(private readonly events: EventBus) {}

  public getState(): GameScreenId {
    return this.current;
  }

  public transition(next: GameScreenId): void {
    if (this.current === next) return;
    this.current = next;
    this.events.emit('screen:changed', { screen: next });
  }
}
