import { Subscription } from 'rxjs'

export class Subscribed {
  private readonly subscriptions: Subscription[] = []

  public addSubscriptions(...subscriptions: Subscription[]) {
    this.subscriptions.push(...subscriptions)
  }

  protected unsubscribe() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe())
  }
}
