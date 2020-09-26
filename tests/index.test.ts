import { of } from 'rxjs';
import { run } from '../src';

describe('autorun', () => {
    let observer: {
        next: jest.Mock;
        error: jest.Mock;
        complete: jest.Mock;
    };

    beforeEach(() => {
        observer = {
            next: jest.fn(),
            error: jest.fn(),
            complete: jest.fn(),
        };
    });

    test('Simple cold observable', () => {
        const o = of(1);
        const r = run(($) => $(o));
        r.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    it('should complete with tracked observables', () => {
        const o = of(1);
        const r = run(($) => $(o));
        r.subscribe(observer);
        expect(observer.complete.mock.calls.length).toBe(1);
    });
});
