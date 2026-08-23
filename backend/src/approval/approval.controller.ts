import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApprovalService } from "./approval.service";

@Controller("approvals")
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get()
  list() {
    return this.approvalService.listPending();
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.approvalService.getOne(id);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @Body("reviewerId") reviewerId?: string) {
    return this.approvalService.approve(id, reviewerId);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string, @Body("reviewerId") reviewerId?: string) {
    return this.approvalService.reject(id, reviewerId);
  }

  @Post(":id/request-changes")
  requestChanges(@Param("id") id: string, @Body("reviewerId") reviewerId?: string) {
    return this.approvalService.requestChanges(id, reviewerId);
  }
}