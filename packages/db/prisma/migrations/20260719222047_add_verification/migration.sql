-- CreateTable
CREATE TABLE "Verification" (
    "id" SERIAL NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- NOTE: prisma migrate dev originally generated a DROP of the hand-written
-- partial index one_active_pass_per_student here (it lives only in
-- 20260316171044_add_pass_model, never in schema.prisma, so the diff sees it
-- as drift). The DROP was removed by hand — do not reintroduce it.
