// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal ERC-20 used only on a local test chain to exercise $CHOG burn verification.
contract TestToken {
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; emit Transfer(msg.sender, to, amount); return true;
    }
}
