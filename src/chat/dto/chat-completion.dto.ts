import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * A single OpenAI chat message. `content` is typed as a string here; the
 * OpenAI spec also permits content parts (arrays), which the controller
 * normalises before validation is consulted for matching.
 */
export class ChatMessageDto {
  @IsString()
  role!: string;

  @IsString()
  content!: string;
}

/**
 * Request body for POST /v1/chat/completions. Unknown OpenAI fields
 * (temperature, top_p, etc.) are allowed and ignored by this mock server.
 */
export class ChatCompletionRequestDto {
  @IsString()
  model!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}
