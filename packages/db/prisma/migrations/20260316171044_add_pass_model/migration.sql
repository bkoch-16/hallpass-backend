-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('PENDING', 'WAITING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DENIED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Pass" (
    "id" SERIAL NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "destinationId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "approverId" INTEGER,
    "denierId" INTEGER,
    "cancellerId" INTEGER,
    "status" "PassStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "approverNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pass_schoolId_idx" ON "Pass"("schoolId");

-- CreateIndex
CREATE INDEX "Pass_studentId_idx" ON "Pass"("studentId");

-- CreateIndex
CREATE INDEX "Pass_status_idx" ON "Pass"("status");

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_denierId_fkey" FOREIGN KEY ("denierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_cancellerId_fkey" FOREIGN KEY ("cancellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX one_active_pass_per_student ON "Pass" ("studentId") WHERE status IN ('PENDING', 'WAITING', 'ACTIVE');
