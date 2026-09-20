import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isValidVersion } from '../../common/utils/semver';

@ValidatorConstraint({ name: 'isVersionString', async: false })
export class IsVersionString implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidVersion(value);
  }

  defaultMessage(): string {
    return 'must be a version like 1.2.3';
  }
}
