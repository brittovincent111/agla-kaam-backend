import { IsIn, IsOptional } from 'class-validator';
import {
  HELP_VIDEO_LANGUAGES,
  HELP_VIDEO_SCREENS,
  type HelpVideoLanguage,
  type HelpVideoScreen,
} from '../help-video-options';

export class ListHelpVideosDto {
  /** Omitted reads as 'home' (every screen). */
  @IsOptional()
  @IsIn(HELP_VIDEO_SCREENS)
  screen?: HelpVideoScreen;

  /** Omitted reads as 'en'. */
  @IsOptional()
  @IsIn(HELP_VIDEO_LANGUAGES)
  lang?: HelpVideoLanguage;
}
