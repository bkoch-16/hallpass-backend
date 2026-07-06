-- AlterTable
ALTER TABLE "Pass" ADD COLUMN "requesterId" INTEGER;

-- Backfill: every existing pass was requested by its own student
UPDATE "Pass" SET "requesterId" = "studentId";

ALTER TABLE "Pass" ALTER COLUMN "requesterId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
