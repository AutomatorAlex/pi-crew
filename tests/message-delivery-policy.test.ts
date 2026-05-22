import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendWithDeliveryPolicy } from "../extension/message-delivery-policy.js";

interface SentMessage {
	message: unknown;
	options: unknown;
}

function sendCollector(sent: SentMessage[]) {
	return ((message: unknown, options: unknown) => {
		sent.push({ message, options });
	}) as never;
}

describe("sendWithDeliveryPolicy", () => {
	it("sends idle messages with triggerTurn only", () => {
		const sent: SentMessage[] = [];
		const message = { customType: "crew-result", content: "done" };

		sendWithDeliveryPolicy(message as never, sendCollector(sent), {
			isIdle: true,
			triggerTurn: false,
		});

		assert.deepEqual(sent, [
			{
				message,
				options: { triggerTurn: false },
			},
		]);
	});

	it("sends streaming messages as steering messages", () => {
		const sent: SentMessage[] = [];
		const message = { customType: "crew-list-warning", content: "warning" };

		sendWithDeliveryPolicy(message as never, sendCollector(sent), {
			isIdle: false,
			triggerTurn: true,
		});

		assert.deepEqual(sent, [
			{
				message,
				options: { deliverAs: "steer", triggerTurn: true },
			},
		]);
	});
});
