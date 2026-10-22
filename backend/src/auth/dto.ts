import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Password policy shared by every endpoint that sets a password. */
export const PasswordRule = () => (target: object, key: string) => {
  IsString()(target, key);
  MinLength(10, { message: 'Password must be at least 10 characters.' })(target, key);
  MaxLength(128)(target, key);
  Matches(/[a-z]/i, { message: 'Password must include a letter.' })(target, key);
  Matches(/\d/, { message: 'Password must include a number.' })(target, key);
};

export class LoginDto {
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password: string;
  /** Organisation slug — only needed when the email exists in several organisations. */
  @ApiPropertyOptional() @IsOptional() @Transform(lowerTrim) @IsString() @MaxLength(80) organization?: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(254) email: string;
}

export class TokenPasswordDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) token: string;
  @ApiProperty() @PasswordRule() password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) currentPassword: string;
  @ApiProperty() @PasswordRule() newPassword: string;
}
