import z from "zod";
import { packetStatuses } from "@/integrations/drizzle/schema";
import { protectedProcedure } from "../context";
import { packetService } from "../services/packet";

const packetStatusSchema = z.enum(packetStatuses);

const packetSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: packetStatusSchema,
	resumeId: z.string(),
	resumeName: z.string(),
	snapshotId: z.string(),
	snapshotCreatedAt: z.date(),
	sourceResumeUpdatedAt: z.date(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const packetRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/packets",
			tags: ["Packets"],
			operationId: "listPackets",
			summary: "List all packets",
			description:
				"Returns all locally tracked packets for the authenticated user, including status and snapshot metadata.",
			successDescription: "A list of packet records ordered by most recently updated.",
		})
		.output(z.array(packetSchema))
		.handler(async ({ context }) => {
			return packetService.list({ userId: context.user.id });
		}),

	createFromResume: protectedProcedure
		.route({
			method: "POST",
			path: "/packets",
			tags: ["Packets"],
			operationId: "createPacketFromResume",
			summary: "Create packet from resume",
			description:
				"Creates an immutable snapshot of the selected resume and a packet record linked to that snapshot for local lifecycle tracking.",
			successDescription: "The created packet and snapshot metadata.",
		})
		.input(
			z.object({
				resumeId: z.string().describe("The ID of the resume to snapshot."),
				title: z.string().trim().min(1).max(128).optional(),
			}),
		)
		.output(packetSchema)
		.handler(async ({ context, input }) => {
			return packetService.createFromResume({
				userId: context.user.id,
				resumeId: input.resumeId,
				title: input.title,
			});
		}),

	setStatus: protectedProcedure
		.route({
			method: "PATCH",
			path: "/packets/{id}/status",
			tags: ["Packets"],
			operationId: "setPacketStatus",
			summary: "Update packet status",
			description: "Updates the local lifecycle status of a packet.",
			successDescription: "The updated packet record.",
		})
		.input(
			z.object({
				id: z.string(),
				status: packetStatusSchema,
			}),
		)
		.output(packetSchema)
		.handler(async ({ context, input }) => {
			return packetService.setStatus({
				id: input.id,
				status: input.status,
				userId: context.user.id,
			});
		}),
};
