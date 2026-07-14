-- AlterTable
ALTER TABLE "User" ADD COLUMN "pinCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_pinCode_key" ON "User"("pinCode");
