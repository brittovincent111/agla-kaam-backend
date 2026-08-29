import { IsLatitude, IsLongitude } from 'class-validator';

export class ServiceLocationDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
