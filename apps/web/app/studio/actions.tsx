import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch } from "../../lib/api-client";

import { studioApproveEndpoint } from "./api";
import type { StudioApprovalExecuteResult } from "./types";
import { isStudioApprovalExecuteResult } from "./validators";

function getRequiredFormValue(formData: FormData, key: "scene_packet_id" | "repair_patch_id"): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildApprovalResultUrl(payload: Partial<StudioApprovalExecuteResult>): string {
  const params = new URLSearchParams();
  params.set("approval_submitted", "1");
  params.set("writeback_status", payload.writeback_status ?? "提交失败");
  if (typeof payload.approved_chapter_id === "number") {
    params.set("approved_chapter_id", String(payload.approved_chapter_id));
  }
  if (typeof payload.continuity_update_summary === "string" && payload.continuity_update_summary.length > 0) {
    params.set("continuity_update_summary", payload.continuity_update_summary);
  }
  if (typeof payload.unavailable_reason === "string" && payload.unavailable_reason.length > 0) {
    params.set("unavailable_reason", payload.unavailable_reason);
  }
  return `/studio?${params.toString()}`;
}

export async function approveStudioWritebackAction(formData: FormData) {
  "use server";

  const scenePacketId = getRequiredFormValue(formData, "scene_packet_id");
  const repairPatchId = getRequiredFormValue(formData, "repair_patch_id");
  const requestBody: { scene_packet_id?: number; repair_patch_id?: number } = {};

  if (scenePacketId !== undefined && repairPatchId !== undefined) {
    redirect(buildApprovalResultUrl({ writeback_status: "未执行", unavailable_reason: "Scene Packet ID 与 Repair Patch ID 只能提供一个。" }));
  }
  if (scenePacketId !== undefined) {
    requestBody.scene_packet_id = Number(scenePacketId);
  }
  if (repairPatchId !== undefined) {
    requestBody.repair_patch_id = Number(repairPatchId);
  }
  if (requestBody.scene_packet_id === undefined && requestBody.repair_patch_id === undefined) {
    redirect(buildApprovalResultUrl({ writeback_status: "未执行", unavailable_reason: "需要提供 Scene Packet ID 或 Repair Patch ID。" }));
  }

  try {
    const response = await apiFetch(studioApproveEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      redirect(buildApprovalResultUrl({ writeback_status: "提交失败", unavailable_reason: `批准写回 API 返回 ${response.status}` }));
    }
    const payload: unknown = await response.json();
    if (!isStudioApprovalExecuteResult(payload)) {
      redirect(buildApprovalResultUrl({ writeback_status: "提交失败", unavailable_reason: "批准写回 API 返回格式不符合预期" }));
    }
    revalidatePath("/studio");
    redirect(buildApprovalResultUrl(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    redirect(buildApprovalResultUrl({ writeback_status: "提交失败", unavailable_reason: message }));
  }
}
