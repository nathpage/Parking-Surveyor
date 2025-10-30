// Global loading state for snap guides
export const SnapLoadingState = {
  _subscribers: new Set(),
  _state: { loading: false, progress: 0 },
  
  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  },
  
  setState(state) {
    this._state = state;
    this._subscribers.forEach(cb => cb(state));
  },
  
  getState() {
    return this._state;
  }
};