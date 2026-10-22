// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {CaseBook} from "../src/CaseBook.sol";
interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool,bool,bool,bool) external;
}
contract CaseBookTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    CaseBook book;
    bytes32 constant ID = keccak256("2026-10-18-main");
    bytes key = bytes('{"caseId":"2026-10-18-main","key":{},"salt":"fixture","v":1}');
    event CaseOpened(bytes32 indexed caseId, bytes32 answerHash, uint64 opensAt, uint64 closesAt);
    function setUp() public { vm.warp(1000); book = new CaseBook(address(this)); }
    function open() internal { book.openCase(ID,keccak256(key),1000,2000); }
    function testOpenAndClose() public { open(); vm.warp(2000); book.closeCase(ID,key); (bytes32 hash,bool closed)=book.caseOf(ID); require(hash==keccak256(key)&&closed); }
    function testOpenEmits() public { vm.expectEmit(true,false,false,true); emit CaseOpened(ID,keccak256(key),1000,2000); open(); }
    function testWrongKeyReverts() public { open();vm.warp(2000);vm.expectRevert(CaseBook.WrongKey.selector);book.closeCase(ID,bytes("wrong")); }
    function testDoubleOpenReverts() public { open();vm.expectRevert(CaseBook.AlreadyOpened.selector);open(); }
    function testNonOwnerOpenReverts() public { vm.prank(address(7));vm.expectRevert(CaseBook.NotOwner.selector);book.openCase(ID,keccak256(key),1000,2000); }
    function testNonOwnerCloseReverts() public { open();vm.warp(2000);vm.prank(address(7));vm.expectRevert(CaseBook.NotOwner.selector);book.closeCase(ID,key); }
    function testMissingOpenReverts() public { vm.expectRevert(CaseBook.NotOpened.selector);book.closeCase(ID,key); }
    function testPrematureRevealReverts() public { open();vm.expectRevert(CaseBook.TooEarly.selector);book.closeCase(ID,key); }
    function testDoubleCloseReverts() public { open();vm.warp(2000);book.closeCase(ID,key);vm.expectRevert(CaseBook.AlreadyClosed.selector);book.closeCase(ID,key); }
    function testZeroHashRejected() public { vm.expectRevert(CaseBook.InvalidCase.selector);book.openCase(ID,bytes32(0),1000,2000); }
    function testInvalidTimesRejected() public { vm.expectRevert(CaseBook.InvalidCase.selector);book.openCase(ID,keccak256(key),2000,1000); }
    function testOwnershipRequiresAcceptance() public { book.proposeOwner(address(8));require(book.owner()==address(this));vm.prank(address(7));vm.expectRevert(CaseBook.NotOwner.selector);book.acceptOwnership();vm.prank(address(8));book.acceptOwnership();require(book.owner()==address(8)); }
    event SolveRecorded(bytes32 indexed caseId, uint16 indexed tokenId, uint8 result);
    function cast() internal pure returns(uint256[] memory ids,uint8[] memory flags) { ids=new uint256[](3);flags=new uint8[](3);ids[0]=1;ids[1]=1969;ids[2]=500;flags[0]=7;flags[1]=1;flags[2]=1; }
    function closed() internal { open();vm.warp(2000);book.closeCase(ID,key); }
    function weekend(uint8 liars) internal pure returns(uint256[] memory ids,uint8[] memory flags) { ids=new uint256[](4);flags=new uint8[](4);for(uint256 i;i<4;i++){ids[i]=i+10;flags[i]=i<liars?5:1;}flags[0]|=2; }
    function solves(uint256 count,uint16 first) internal pure returns(uint16[] memory ids,uint8[] memory results) { ids=new uint16[](count);results=new uint8[](count);for(uint256 i;i<count;i++){ids[i]=uint16(first+i);results[i]=uint8(1|4|8|(3<<5));} }
    function testCastRecordedOnlyOnce() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();book.recordCast(ID,ids,flags);vm.expectRevert(CaseBook.CastAlreadyRecorded.selector);book.recordCast(ID,ids,flags); }
    function testCastCannotLeakLiarBeforeClose() public { open();(uint256[] memory ids,uint8[] memory flags)=cast();vm.expectRevert(CaseBook.NotOpened.selector);book.recordCast(ID,ids,flags); }
    function testDuplicateCastRejected() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();ids[1]=ids[0];vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testInvalidCastFlagsRejected() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();flags[1]=16;vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testZeroOwnerRejected() public { vm.expectRevert(CaseBook.InvalidOwner.selector); new CaseBook(address(0)); }
    function testZeroCaseIdRejected() public { vm.expectRevert(CaseBook.InvalidCase.selector);book.openCase(bytes32(0),keccak256(key),1000,2000); }
    function testNonOwnerCannotRecordCast() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();vm.prank(address(7));vm.expectRevert(CaseBook.NotOwner.selector);book.recordCast(ID,ids,flags); }
    function testTokenOutsideCollectionRejected() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();ids[1]=1970;vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testCastRequiresOneSubject() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();flags[1]=3;vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testCastRequiresALiar() public { open();vm.warp(2000);book.closeCase(ID,key);(uint256[] memory ids,uint8[] memory flags)=cast();flags[0]=3;vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testLateCommitStillCannotRevealEarly() public { vm.warp(1100);open();vm.expectRevert(CaseBook.TooEarly.selector);book.closeCase(ID,key); }
    function testZeroPendingOwnerRejected() public { vm.expectRevert(CaseBook.InvalidOwner.selector);book.proposeOwner(address(0)); }
    function testWrongCaseCannotUseAnotherCaseKey() public { open();vm.warp(2000);vm.expectRevert(CaseBook.NotOpened.selector);book.closeCase(keccak256("another"),key); }
    function testCastAcceptsOneToThreeLiars() public { for(uint8 liars=1;liars<=3;liars++){bytes32 id=keccak256(abi.encode(liars));book.openCase(id,keccak256(key),1000,2000);vm.warp(2000);book.closeCase(id,key);(uint256[] memory ids,uint8[] memory flags)=weekend(liars);book.recordCast(id,ids,flags);vm.warp(1000);} }
    function testCastRejectsFourLiars() public { closed();(uint256[] memory ids,uint8[] memory flags)=weekend(4);vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testCastSizeIsThreeOrFour() public { closed();uint256[] memory ids=new uint256[](2);uint8[] memory flags=new uint8[](2);ids[0]=1;ids[1]=2;flags[0]=7;flags[1]=1;vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags);ids=new uint256[](5);flags=new uint8[](5);for(uint256 i;i<5;i++){ids[i]=i+1;flags[i]=1;}flags[0]=7;vm.expectRevert(CaseBook.InvalidCast.selector);book.recordCast(ID,ids,flags); }
    function testSolvesBeforeCloseRevert() public { open();(uint16[] memory ids,uint8[] memory results)=solves(3,1);vm.expectRevert(CaseBook.NotOpened.selector);book.recordSolves(ID,ids,results); }
    function testSolvesEmitAndMarkTokens() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(2,1968);vm.expectEmit(true,true,false,true);emit SolveRecorded(ID,1968,results[0]);book.recordSolves(ID,ids,results);require(book.solveRecorded(ID,1968)&&book.solveRecorded(ID,1969)&&!book.solveRecorded(ID,1967)&&!book.solveRecorded(keccak256("another"),1968)); }
    function testSolvesChunkAcrossCalls() public { closed();(uint16[] memory a,uint8[] memory ra)=solves(200,1);book.recordSolves(ID,a,ra);(uint16[] memory b,uint8[] memory rb)=solves(200,201);book.recordSolves(ID,b,rb);require(book.solveRecorded(ID,1)&&book.solveRecorded(ID,256)&&book.solveRecorded(ID,257)&&book.solveRecorded(ID,400)); }
    function testDuplicateSolveInOneChunkReverts() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(3,10);ids[2]=10;vm.expectRevert(CaseBook.SolveAlreadyRecorded.selector);book.recordSolves(ID,ids,results); }
    function testDuplicateSolveAcrossChunksReverts() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(3,10);book.recordSolves(ID,ids,results);(uint16[] memory again,uint8[] memory more)=solves(1,12);vm.expectRevert(CaseBook.SolveAlreadyRecorded.selector);book.recordSolves(ID,again,more); }
    function testNonOwnerCannotRecordSolves() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(1,1);vm.prank(address(7));vm.expectRevert(CaseBook.NotOwner.selector);book.recordSolves(ID,ids,results); }
    function testSolveTokenOutsideCollectionReverts() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(1,0);vm.expectRevert(CaseBook.InvalidSolves.selector);book.recordSolves(ID,ids,results);ids[0]=1970;vm.expectRevert(CaseBook.InvalidSolves.selector);book.recordSolves(ID,ids,results); }
    function testSolveChunkLimits() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(201,1);vm.expectRevert(CaseBook.InvalidSolves.selector);book.recordSolves(ID,ids,results);(ids,results)=solves(0,1);vm.expectRevert(CaseBook.InvalidSolves.selector);book.recordSolves(ID,ids,results);(ids,results)=solves(2,1);uint8[] memory short=new uint8[](1);vm.expectRevert(CaseBook.InvalidSolves.selector);book.recordSolves(ID,ids,short); }
    function testSolveResultHighBitRejected() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(1,1);results[0]=128;vm.expectRevert(CaseBook.InvalidSolves.selector);book.recordSolves(ID,ids,results); }
    function testGasRecordTwoHundredSolves() public { closed();(uint16[] memory ids,uint8[] memory results)=solves(200,1000);book.recordSolves(ID,ids,results); }
}
