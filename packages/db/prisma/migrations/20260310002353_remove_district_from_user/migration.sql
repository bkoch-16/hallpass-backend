/*
  Warnings:

  - You are about to drop the column `districtId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_districtId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "districtId";
