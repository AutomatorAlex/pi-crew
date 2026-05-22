import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SendMessageFn = ExtensionAPI["sendMessage"];
type Message = Parameters<SendMessageFn>[0];

interface DeliveryOptions {
	isIdle: boolean;
	triggerTurn: boolean;
}

export function sendWithDeliveryPolicy(
	message: Message,
	sendMessage: SendMessageFn,
	opts: DeliveryOptions,
): void {
	sendMessage(
		message,
		opts.isIdle
			? { triggerTurn: opts.triggerTurn }
			: { deliverAs: "steer", triggerTurn: opts.triggerTurn },
	);
}
