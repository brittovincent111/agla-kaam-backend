import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  HELP_VIDEO_AUDIENCES,
  HELP_VIDEO_LANGUAGES,
  HELP_VIDEO_SCREENS,
  type HelpVideoAudience,
  type HelpVideoLanguage,
  type HelpVideoScreen,
} from '../help-video-options';

/**
 * Either `url` (any YouTube link form) or a bare `youtubeId`; the service
 * extracts and checks the id, so a bad link gets one clear message.
 */
export class CreateHelpVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  youtubeId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsIn(HELP_VIDEO_SCREENS)
  screen: HelpVideoScreen;

  @IsOptional()
  @IsIn(HELP_VIDEO_LANGUAGES)
  language?: HelpVideoLanguage;

  @IsOptional()
  @IsIn(HELP_VIDEO_AUDIENCES)
  audience?: HelpVideoAudience;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Tall video. Omitted: worked out from the link (/shorts/). */
  @IsOptional()
  @IsBoolean()
  isShort?: boolean;
}
