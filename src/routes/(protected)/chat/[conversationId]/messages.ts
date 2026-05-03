import { getConversationMessages } from "$lib/api/conversation";
import type { Message } from "$lib/model/message";

type StackedMessage = Message & {
	indexInStack: number;
	stackLength: number;
};

export function getStackedMessages<T extends Message>({
	messages,
	ourProfileId,
}: {
	messages: T[];
	ourProfileId: number;
}) {
	const stackedMessages: (T & StackedMessage)[] = [];

	let stack:
		| {
				time: number;
				isOut: boolean;
				messages: T[];
		  }
		| undefined;
	const flush = () => {
		if (stack) {
			const stackMessages = stack.messages;
			stackedMessages.push(
				...stackMessages.map((msg, i, arr) => ({
					...msg,
					indexInStack: arr.length - 1 - i,
					stackLength: arr.length,
				})),
			);
			stack = undefined;
		}
	};
	for (const message of messages) {
		const isOut = message.senderId === ourProfileId;
		const timeMs = new Date(message.timestamp).getTime();
		const time = Math.floor(timeMs / 60000) * 60000;
		if (stack && stack.isOut === isOut && time === stack.time) {
			stack.messages.push(message);
		} else {
			flush();
			stack = {
				time,
				isOut,
				messages: [message],
			};
		}
	}
	flush();

	return stackedMessages;
}

type GroupedMessage = Message & {
	dayStart?: number;
};

export function groupMessagesByDate<T extends Message>({
	messages,
}: {
	messages: T[];
}): (T & GroupedMessage)[] {
	let dayStartGroup: number | undefined;
	const groupedMessages = messages.toReversed().map((message) => {
		const dayStart = new Date(message.timestamp).setHours(0, 0, 0, 0);
		if (dayStart !== dayStartGroup) {
			dayStartGroup = dayStart;
			return {
				...message,
				dayStart,
			};
		}
		return message;
	});
	return groupedMessages.toReversed();
}

export async function getConversation({
	conversationId,
	ourProfileId,
}: {
	conversationId: string;
	ourProfileId: number;
}) {
	return await getConversationMessages(conversationId).then((res) => {
		const stackedMessages = getStackedMessages({
			messages: res.messages,
			ourProfileId,
		});
		const groupedMessages = groupMessagesByDate({
			messages: stackedMessages,
		});
		return {
			...res,
			messages: groupedMessages,
		};
	});
}
