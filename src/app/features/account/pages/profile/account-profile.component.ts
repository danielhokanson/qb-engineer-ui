import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent } from '../../../../shared/components/select/select.component';
import { DatepickerComponent } from '../../../../shared/components/datepicker/datepicker.component';
import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { AccountService } from '../../services/account.service';
import { EmployeeProfileService } from '../../services/employee-profile.service';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#64748b', '#78716c',
];

const GENDER_OPTIONS = [
  { value: null, label: '-- None --' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Non-binary', label: 'Non-binary' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

@Component({
  selector: 'app-account-profile',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputComponent, SelectComponent, DatepickerComponent, AvatarComponent, ValidationButtonComponent],
  templateUrl: './account-profile.component.html',
  styleUrl: './account-profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly accountService = inject(AccountService);
  private readonly profileService = inject(EmployeeProfileService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  protected readonly user = this.authService.user;
  protected readonly profile = this.profileService.profile;
  protected readonly avatarColors = AVATAR_COLORS;
  protected readonly genderOptions = GENDER_OPTIONS;
  protected readonly saving = signal(false);
  protected readonly selectedColor = signal('');

  protected readonly form = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    initials: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(3)] }),
    avatarColor: new FormControl('', { nonNullable: true }),
    dateOfBirth: new FormControl<string | null>(null),
    gender: new FormControl<string | null>(null),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    firstName: 'First Name',
    lastName: 'Last Name',
  });

  constructor() {
    const u = this.user();
    if (u) {
      this.form.patchValue({
        firstName: u.firstName,
        lastName: u.lastName,
        initials: u.initials ?? '',
        avatarColor: u.avatarColor ?? '',
      });
      this.selectedColor.set(u.avatarColor ?? '');
    }

    const p = this.profile();
    if (p) {
      this.form.patchValue({
        dateOfBirth: p.dateOfBirth,
        gender: p.gender,
      });
    }
  }

  protected selectColor(color: string): void {
    this.selectedColor.set(color);
    this.form.patchValue({ avatarColor: color });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    const val = this.form.getRawValue();
    this.saving.set(true);

    // Save auth profile (name, initials, color)
    this.accountService.updateProfile({
      firstName: val.firstName,
      lastName: val.lastName,
      initials: val.initials || null,
      avatarColor: val.avatarColor || null,
    }).subscribe({
      next: () => {
        this.authService.refreshUser({
          firstName: val.firstName,
          lastName: val.lastName,
          initials: val.initials || null,
          avatarColor: val.avatarColor || null,
        });
      },
    });

    // Save employee profile (dob, gender)
    const current = this.profile();
    this.profileService.updateProfile({
      dateOfBirth: val.dateOfBirth,
      gender: val.gender,
      street1: current?.street1 ?? null,
      street2: current?.street2 ?? null,
      city: current?.city ?? null,
      state: current?.state ?? null,
      zipCode: current?.zipCode ?? null,
      country: current?.country ?? null,
      phoneNumber: current?.phoneNumber ?? null,
      personalEmail: current?.personalEmail ?? null,
      emergencyContactName: current?.emergencyContactName ?? null,
      emergencyContactPhone: current?.emergencyContactPhone ?? null,
      emergencyContactRelationship: current?.emergencyContactRelationship ?? null,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackbar.success(this.translate.instant('account.profileUpdated'));
      },
      error: () => this.saving.set(false),
    });
  }
}
