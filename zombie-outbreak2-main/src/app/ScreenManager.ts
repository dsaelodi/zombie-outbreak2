import type { GameScreenId } from '../core/EventBus';

export interface IScreen {
  mount(container: HTMLElement): void;
  unmount(): void;
}

export class ScreenManager {
  private activeScreen: IScreen | null = null;
  private readonly screens = new Map<GameScreenId, IScreen>();

  constructor(private readonly container: HTMLElement) {}

  public register(id: GameScreenId, screen: IScreen): void {
    this.screens.set(id, screen);
  }

  public show(id: GameScreenId): void {
    if (this.activeScreen) {
      this.activeScreen.unmount();
      this.activeScreen = null;
    }
    this.container.innerHTML = '';

    const next = this.screens.get(id);
    if (!next) return;
    this.activeScreen = next;
    next.mount(this.container);
  }

  public getActiveScreen(): IScreen | null {
    return this.activeScreen;
  }
}
