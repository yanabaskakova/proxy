import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * A single OpenAI chat message. `content` accepts either a plain string or the
 * OpenAI content-parts form (`[{type:"text", text:"..."}, ...]`); the array
 * form is flattened to a string here so downstream code stays string-only.
 */
export class ChatMessageDto {
  @IsString()
  role!: string;

  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
    }
    return value;
  })
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
