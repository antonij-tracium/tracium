import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import SignupPage from './SignupPage';
import * as api from '../api';

Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation(query => ({matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()})) });

function submit(email:string,password:string){
 fireEvent.change(screen.getByLabelText('Email address'),{target:{value:email}});
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:password}});
 fireEvent.click(screen.getByRole('button',{name:'Create free account'}));
}

describe('SignupPage',()=>{
 beforeEach(()=>vi.restoreAllMocks());

 it('prompts to confirm the email when registration withholds the session',async()=>{
  vi.spyOn(api,'registerUser').mockResolvedValue({token:null,confirmationRequired:true});
  const onLogin=vi.fn();
  render(<MemoryRouter><SignupPage onLogin={onLogin}/></MemoryRouter>);
  submit('ada@example.com','sufficiently-long-pass');
  await waitFor(()=>expect(screen.getByText('Confirm your email')).toBeTruthy());
  expect(screen.getByText('ada@example.com')).toBeTruthy();
  expect(onLogin).not.toHaveBeenCalled();
 });

 it('signs in immediately when a token is issued',async()=>{
  vi.spyOn(api,'registerUser').mockResolvedValue({token:'jwt-123',confirmationRequired:false});
  const onLogin=vi.fn();
  render(<MemoryRouter><SignupPage onLogin={onLogin}/></MemoryRouter>);
  submit('ada@example.com','sufficiently-long-pass');
  await waitFor(()=>expect(onLogin).toHaveBeenCalledWith('jwt-123','ada@example.com'));
 });

 it('sends only credentials when no extension adds signup fields',async()=>{
  const register=vi.spyOn(api,'registerUser').mockResolvedValue({token:'jwt-123',confirmationRequired:false});
  render(<MemoryRouter><SignupPage onLogin={vi.fn()}/></MemoryRouter>);
  submit('ada@example.com','sufficiently-long-pass');
  await waitFor(()=>expect(register).toHaveBeenCalledWith({email:'ada@example.com',password:'sufficiently-long-pass'}));
 });

 it('renders extension signup fields, sends their values and bumps attempt on failure',async()=>{
  const register=vi.spyOn(api,'registerUser').mockRejectedValue(new api.AuthError('Verification failed',403));
  const seen:number[]=[];
  function Fields({onChange,attempt}:{onChange:(f:Record<string,string>)=>void;attempt:number}){
   seen.push(attempt);
   return <button type="button" onClick={()=>onChange({token:'t-'+attempt})}>solve</button>;
  }
  render(<MemoryRouter><SignupPage onLogin={vi.fn()} fields={Fields}/></MemoryRouter>);
  fireEvent.click(screen.getByText('solve'));
  submit('ada@example.com','sufficiently-long-pass');
  await waitFor(()=>expect(screen.getByText('Verification failed')).toBeTruthy());
  expect(register).toHaveBeenCalledWith({email:'ada@example.com',password:'sufficiently-long-pass',extensions:{token:'t-0'}});
  expect(seen[seen.length-1]).toBe(1);
 });
});
