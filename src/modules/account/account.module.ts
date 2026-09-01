import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { AuthModule } from "../auth/auth.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";

@Module({
  imports: [ConfigModule, AuthModule, RepositoriesModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
