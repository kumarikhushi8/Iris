import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("stats")
  async getDashboardStats() {
    // Basic operational metrics for the frontend dashboard (FR-20)
    
    // 1. Build volume by status
    const buildCounts = await this.prisma.build.groupBy({
      by: ["status"],
      _count: true,
    });

    const statusMap = buildCounts.reduce((acc, curr) => {
      acc[curr.status] = curr._count;
      return acc;
    }, {} as Record<string, number>);

    // 2. Diagnoses completed
    const diagnoses = await this.prisma.diagnosis.count();
    const validated = await this.prisma.diagnosis.count({
      where: {
        status: { in: ["awaiting_approval", "approved", "rejected"] },
      },
    });

    // 3. Evaluation accuracy (FR-21)
    // We don't have historical runs in schema, just current evaluation_set match state.
    const evalSet = await this.prisma.evaluationSet.findMany();
    const totalEval = evalSet.length;
    const matchedEval = evalSet.filter((e) => e.match).length;
    const currentAccuracy = totalEval > 0 ? matchedEval / totalEval : 0;

    return {
      builds: {
        success: statusMap["success"] || 0,
        failed: statusMap["failed"] || 0,
        total: (statusMap["success"] || 0) + (statusMap["failed"] || 0),
      },
      diagnoses: {
        total: diagnoses,
        validated: validated,
      },
      evaluationTrend: [
        {
          runAt: new Date().toISOString(),
          accuracyScore: currentAccuracy,
        }
      ],
    };
  }
}
