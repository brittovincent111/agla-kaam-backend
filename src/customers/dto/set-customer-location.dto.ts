import { IsLatitude, IsLongitude } from 'class-validator';

export class SetCustomerLocationDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
